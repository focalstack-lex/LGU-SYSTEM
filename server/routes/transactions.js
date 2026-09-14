const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { sanitizeText, validateDriveUrl, isPositiveNumber, isValidEnum, isValidUUID, assertRequired } = require('../lib/validate');
const { logAudit } = require('../lib/audit');
const { logError } = require('../lib/logger');
const { requireAdmin, requireOfficer } = require('../middleware/roles');
const { createNotification } = require('./notifications');

const VALID_TX_TYPES = ['expense', 'donation', 'collection', 'allocation', 'transfer'];
const MAX_LIMIT      = 100;
const MAX_OFFSET     = 10000;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_MIME_EXT = {
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
  'application/pdf': 'pdf'
};

// Receipt uploads arrive as multipart; the CSV bulk import posts JSON, so
// multer is only engaged when the request actually is multipart.
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_RECEIPT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!RECEIPT_MIME_EXT[file.mimetype]) {
      return cb(new Error('Receipt must be a JPEG, PNG, WebP image or PDF.'));
    }
    cb(null, true);
  }
});

function parseReceiptWhenMultipart(req, res, next) {
  if (req.is('multipart/form-data')) {
    return receiptUpload.single('receipt')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? 'Receipt exceeds the 5 MB limit.'
          : err.message;
        return res.status(400).json({ error: msg });
      }
      next();
    });
  }
  next();
}

// Signs storage-backed receipt paths for display; legacy links pass through.
async function signReceipt(tx) {
  if (tx.receipt_url && tx.receipt_url.startsWith('receipts/')) {
    const { data, error } = await supabase.storage
      .from('receipts')
      .createSignedUrl(tx.receipt_url.replace(/^receipts\//, ''), 3600);
    if (!error && data?.signedUrl) {
      return { ...tx, receipt_url: data.signedUrl };
    }
  }
  return tx;
}

// GET /api/transactions
router.get('/', async (req, res) => {
  const event_id = req.query.event_id || null;
  const type     = req.query.type     || null;
  const search   = req.query.search   ? String(req.query.search).trim() : null;
  const page     = req.query.page     ? Math.max(1, parseInt(req.query.page, 10) || 1) : null;
  const limit    = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), MAX_LIMIT);
  const offset   = page !== null ? (page - 1) * limit : Math.min(Math.max(0, parseInt(req.query.offset, 10) || 0), MAX_OFFSET);

  let query = supabase
    .from('transactions')
    .select('*, profiles!added_by(full_name), events(event_name)', { count: 'exact' });

  // Validate type filter (supports single type or comma-separated list)
  if (type) {
    const types = type.split(',').map(t => t.trim()).filter(Boolean);
    const invalid = types.find(t => !isValidEnum(t, VALID_TX_TYPES));
    if (invalid) {
      return res.status(400).json({ error: `Invalid transaction type filter: ${invalid}.` });
    }
    if (types.length === 1) {
      query = query.eq('type', types[0]);
    } else {
      query = query.in('type', types);
    }
  }

  if (event_id) {
    if (event_id === 'GENERAL' || event_id === 'null' || event_id === 'none') {
      query = query.is('event_id', null);
    } else if (isValidUUID(event_id)) {
      query = query.eq('event_id', event_id);
    } else {
      return res.status(400).json({ error: 'Invalid event_id format.' });
    }
  }

  if (search) {
    query = query.ilike('description', `%${search}%`);
  }

  query = query
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    logError('Transactions List Error', error);
    return res.status(500).json({ error: 'Failed to fetch transactions.' });
  }

  const signed = await Promise.all((data || []).map(signReceipt));
  res.set('X-Total-Count', String(count || 0));

  if (page !== null || req.query.paginate === 'true') {
    res.json({
      data: signed,
      total: count || 0,
      page: page || 1,
      limit,
      totalPages: Math.max(1, Math.ceil((count || 0) / limit))
    });
  } else {
    res.json(signed);
  }
});

// POST /api/transactions (officers and admins)
// Accepts multipart/form-data (transaction fields + optional 'receipt' file
// captured by the in-system camera) or plain JSON for legacy callers.
router.post('/', requireOfficer, parseReceiptWhenMultipart, async (req, res) => {
  const { event_id, type, amount, description, donor_name, transaction_date, receipt_url } = req.body;
  // use_allocation arrives as the string 'true'/'false' under multipart
  const use_allocation = req.body.use_allocation === undefined
    ? undefined
    : req.body.use_allocation === true || req.body.use_allocation === 'true';

  // Normalize event_id ('GENERAL' or empty string -> null)
  const cleanEventId = (event_id === 'GENERAL' || event_id === '' || event_id === 'null' || !event_id)
    ? null
    : (isValidUUID(event_id) ? event_id : null);

  // 1. Required field check (event_id is optional for General Income)
  const missing = assertRequired({ type, amount, description, transaction_date });
  if (missing) return res.status(400).json({ error: missing });

  // 2. Type enum validation
  if (!isValidEnum(type, VALID_TX_TYPES)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TX_TYPES.join(', ')}.` });
  }
  if (type === 'transfer') {
    return res.status(400).json({ error: 'Transfer transactions can only be created via the budget transfer interface.' });
  }

  // 3. Amount must be a positive number
  if (!isPositiveNumber(amount)) {
    return res.status(400).json({ error: 'Amount must be a positive number.' });
  }

  // 4. Budget Overdraft Validation
  if (type === 'expense') {
    if (use_allocation && cleanEventId) {
      // Check against Event balance
      const [{ data: event }, { data: evTxs }] = await Promise.all([
        supabase.from('events').select('allocated_budget').eq('id', cleanEventId).single(),
        supabase.from('transactions').select('type, amount, use_allocation').eq('event_id', cleanEventId)
      ]);
      if (event) {
        let allocExp = 0;
        (evTxs || []).forEach(tx => {
           if (tx.type === 'expense' && tx.use_allocation) {
              allocExp += Number(tx.amount);
           }
        });
        const remaining = Number(event.allocated_budget) - allocExp;
        if (Number(amount) > remaining) {
           return res.status(400).json({ error: `Amount exceeds available event budget (₱${remaining.toLocaleString()}).` });
        }
      }
    } else {
      // Check against Dashboard balance (Envelope limits applies)
      const [{ data: allTxs }, { data: events }] = await Promise.all([
         supabase.from('transactions').select('type, amount, use_allocation'),
         supabase.from('events').select('allocated_budget')
      ]);
      
      let dashExp = 0, dashInc = 0, reservedEnvelopes = 0;
      (events || []).forEach(e => reservedEnvelopes += Number(e.allocated_budget));
      
      (allTxs || []).forEach(tx => {
         if (tx.type === 'expense') {
            if (!tx.use_allocation) dashExp += Number(tx.amount);
         } else {
            dashInc += Number(tx.amount);
         }
      });
      const remaining = dashInc - dashExp - reservedEnvelopes;
      if (Number(amount) > remaining) {
         return res.status(400).json({ error: `Amount exceeds available general fund (₱${remaining.toLocaleString()}).` });
      }
    }
  }

  // 4. Sanitize inputs
  const cleanDesc   = sanitizeText(description);
  const cleanDonor  = donor_name ? sanitizeText(donor_name) : null;
  const cleanReceipt = receipt_url ? validateDriveUrl(receipt_url) : null;

  // BUG-001 FIX: validateDriveUrl now returns the URL string or null (not boolean).
  // Reject if a receipt URL was provided but failed validation.
  if (receipt_url && !cleanReceipt) {
    return res.status(400).json({ error: 'Receipt URL must be a valid Google Drive or Google Docs link (https only).' });
  }

  if (cleanDesc.length > 500) {
    return res.status(400).json({ error: 'Description must be 500 characters or less.' });
  }

  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .insert({
      event_id:         cleanEventId,
      type,
      amount:           Number(amount),
      description:      cleanDesc,
      donor_name:       cleanDonor,
      receipt_url:      cleanReceipt,
      added_by:         req.user.id,
      transaction_date: transaction_date,
      use_allocation:   use_allocation !== undefined ? use_allocation : true
    })
    .select()
    .single();

  if (txError) return res.status(400).json({ error: 'Failed to create transaction.' });

  // Auto-dispatch real-time notification for transactions category (Ledger)
  createNotification({
    targetRole: 'all',
    type: 'transaction',
    title: `💳 New Transaction: ₱${Number(amount).toLocaleString()} (${type.toUpperCase()})`,
    message: cleanDesc,
    category: 'transactions',
    link: 'transactions',
    metadata: { transaction_id: tx.id, amount, type }
  });

  let receiptWarning = null;

  if (req.file) {
    // In-system receipt capture: upload to the private 'receipts' bucket,
    // then point the transaction at the storage path. A storage failure must
    // not lose the transaction - it is saved with no receipt instead.
    const ext      = RECEIPT_MIME_EXT[req.file.mimetype];
    const folder   = event_id || 'general';
    const objectPath = `${folder}/${tx.id}.${ext}`;
    const storagePath = `receipts/${objectPath}`;

    const { error: upErr } = await supabase.storage
      .from('receipts')
      .upload(objectPath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600'
      });

    if (upErr) {
      logError('Receipt Upload Error', upErr);
      receiptWarning = 'Transaction saved, but the receipt upload failed. You can edit the transaction later to attach it.';
    } else {
      await supabase.from('transactions').update({ receipt_url: storagePath }).eq('id', tx.id);
      tx.receipt_url = storagePath;

      await supabase.from('receipts').insert({
        transaction_id: tx.id,
        file_url:       storagePath,
        file_name:      req.file.originalname || `receipt.${ext}`,
        file_type:      req.file.mimetype,
        uploaded_by:    req.user.id,
      });
    }
  }

  if (receipt_url && !req.file) {
    await supabase.from('receipts').insert({
      transaction_id: tx.id,
      file_url:       cleanReceipt,
      file_name:      'Google Drive Link',
      file_type:      'link/gdrive',
      uploaded_by:    req.user.id,
    });
  }

  // Check over-budget for expenses
  if (type === 'expense' && cleanEventId) {
    const { data: ev } = await supabase.from('events').select('allocated_budget, remaining_budget').eq('id', cleanEventId).single();
    if (ev && Number(ev.remaining_budget) < Number(ev.allocated_budget) * 0.1) {
      tx.over_budget_warning = true;
      logAudit(req.user.id, 'OVER_BUDGET_ALERT', { event_id: cleanEventId, remaining_budget: ev.remaining_budget });
    }
  }

  logAudit(req.user.id, 'CREATE_TRANSACTION', {
    transaction_id: tx.id,
    event_id: cleanEventId,
    type,
    amount:      Number(amount),
    description: cleanDesc
  });

  res.status(201).json(receiptWarning ? { ...tx, warning: receiptWarning } : tx);
});

// POST /api/transactions/bulk (admin only)
router.post('/bulk', requireAdmin, async (req, res) => {
  const { transactions } = req.body;

  if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > 500) {
    return res.status(400).json({ error: 'Valid transactions array (max 500) is required.' });
  }

  // 1. Initial Validation & Sanitization Loop
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const missing = assertRequired({ 
      type: tx.type, 
      amount: tx.amount, 
      description: tx.description, 
      transaction_date: tx.transaction_date 
    });
    if (missing) return res.status(400).json({ error: `Row ${i + 1} missing data: ${missing}` });
    
    if (!isValidEnum(tx.type, VALID_TX_TYPES)) {
      return res.status(400).json({ error: `Row ${i + 1} error: Invalid type (${tx.type}).` });
    }
    if (tx.type === 'transfer') {
      return res.status(400).json({ error: `Row ${i + 1} error: Transfer transactions cannot be bulk imported.` });
    }
    if (!isPositiveNumber(tx.amount)) {
      return res.status(400).json({ error: `Row ${i + 1} error: Amount must be > 0.` });
    }
    
    // Normalize event_id ('GENERAL', 'null', empty string -> null)
    const rawEvId = tx.event_id;
    tx.event_id = (rawEvId === 'GENERAL' || rawEvId === '' || rawEvId === 'null' || !rawEvId)
      ? null
      : (isValidUUID(rawEvId) ? rawEvId : null);

    // Transform inline for insertion
    tx.amount = Number(tx.amount);
    tx.description = sanitizeText(String(tx.description)).slice(0, 500);
    tx.donor_name = tx.donor_name ? sanitizeText(String(tx.donor_name)) : null;
    tx.added_by = req.user.id;
  }

  // 2. Safe Bulk Insert to Database
  const { data, error } = await supabase
    .from('transactions')
    .insert(transactions)
    .select();

  if (error) {
    logError('Bulk Insert Error', error);
    return res.status(500).json({ error: 'Database bulk insert failed.' });
  }

  logAudit(req.user.id, 'BULK_IMPORT_TRANSACTIONS', { 
    count: transactions.length, 
    sample_event_id: transactions[0].event_id 
  });

  res.status(201).json({ message: 'Bulk import successful.', count: transactions.length });
});

// PATCH /api/transactions/:id - edit with mandatory reason (admin only)
router.patch('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { amount, description, transaction_date, reason, receipt_url } = req.body;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }

  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'A reason of at least 5 characters is required to edit a transaction.' });
  }

  if (req.body.type === 'transfer') {
    return res.status(400).json({ error: 'Transfer transactions cannot be modified directly.' });
  }

  const updates = {};
  if (amount !== undefined) {
    if (!isPositiveNumber(amount)) return res.status(400).json({ error: 'Amount must be a positive number.' });
    updates.amount = Number(amount);
  }
  if (description !== undefined) updates.description = sanitizeText(String(description)).slice(0, 500);
  if (transaction_date !== undefined) updates.transaction_date = transaction_date;
  if (receipt_url !== undefined) {
    const candidate = sanitizeText(String(receipt_url));
    // The edit dialog echoes back the signed URL the server issued for a
    // storage receipt. Saving that would clobber the permanent storage path,
    // so an echo is treated as "unchanged" and ignored.
    if (!candidate.includes('/object/sign/')) {
      updates.receipt_url = candidate;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update.' });
  }

  const { data, error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: 'Failed to update transaction.' });

  logAudit(req.user.id, 'EDIT_TRANSACTION', { transaction_id: id, changes: updates, reason: sanitizeText(reason) });
  res.json(data);
});

// DELETE /api/transactions/:id - soft-delete with mandatory reason (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }

  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'A reason of at least 5 characters is required to delete a transaction.' });
  }

  const { data: tx } = await supabase.from('transactions').select('description').eq('id', id).single();
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) return res.status(400).json({ error: 'Failed to delete transaction.' });

  logAudit(req.user.id, 'DELETE_TRANSACTION', { 
    transaction_id: id, 
    description: tx?.description || 'Unknown', 
    reason: sanitizeText(reason) 
  });
  res.json({ message: 'Transaction deleted successfully.' });
});

module.exports = router;
