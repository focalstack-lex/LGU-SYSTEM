// =============================================
// server/routes/admin.js - Admin-Only Operations
// =============================================
const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { isPositiveNumber, isValidEnum, isValidUUID, sanitizeText } = require('../lib/validate');
const { logAudit } = require('../lib/audit');
const { logError } = require('../lib/logger');
const { requireAdmin, requireGovernorOrAdmin, requireOfficer } = require('../middleware/roles');
const { createNotification } = require('./notifications');
const { sendAccountApprovalEmail } = require('../lib/email');

const ASSIGNABLE_ROLES = ['admin', 'student', 'governor', 'cashier', 'officer'];
const OFFICER_ASSIGNABLE_ROLES = ['student', 'governor', 'cashier', 'officer'];

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', requireOfficer, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, course, year_level, is_verified, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch users.' });
  res.json(data);
});

// ── POST /api/admin/profile ───────────────────────────────────────────
// Allows an authenticated user to create or update their own profile safely
router.post('/profile', async (req, res) => {
  const userId = req.user?.id;
  const email = req.user?.email || '';

  if (!userId) {
    return res.status(401).json({ error: 'User session not active.' });
  }

  const { full_name, course, year_level, enrollment_year, avatar_url } = req.body;

  // Preserve existing role if present; default to student for new profile rows
  const { data: existing } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  const role = existing?.role || 'student';

  const yearNum = year_level ? parseInt(String(year_level).replace(/\D/g, ''), 10) : null;
  const computedEnrollmentYear = (yearNum && yearNum >= 1 && yearNum <= 6)
    ? (2026 - (yearNum - 1))
    : (enrollment_year ? Number(enrollment_year) : 2026);

  const updates = {
    id: userId,
    email: email,
    full_name: sanitizeText(full_name || req.user.user_metadata?.full_name || 'COE Member'),
    role: role,
    course: course || null,
    year_level: year_level || null,
    enrollment_year: computedEnrollmentYear,
    ...(avatar_url !== undefined && { avatar_url })
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(updates, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    logError('Profile self-upsert failed:', error);
    return res.status(400).json({ error: 'Failed to update profile details.' });
  }

  res.json(data);
});

// ── PATCH /api/admin/users/:id/role ──────────────────────────────────────────
// Admins may assign any role; governors may assign officer/student roles but
// never touch admin accounts; officers and cashiers have no role-assignment power.
router.patch('/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const actorRole = req.profile?.role;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }
  if (!isValidEnum(role, ASSIGNABLE_ROLES)) {
    return res.status(400).json({ error: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.` });
  }
  if (['cashier', 'officer'].includes(actorRole)) {
    return res.status(403).json({ error: 'Officers and cashiers cannot assign roles.' });
  }
  if (actorRole === 'governor') {
    if (!OFFICER_ASSIGNABLE_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Only admins can assign the admin role.' });
    }
    const { data: target } = await supabase.from('profiles').select('role').eq('id', id).single();
    if (target?.role === 'admin') {
      return res.status(403).json({ error: 'Governors cannot modify admin accounts.' });
    }
  }

  // Prevent self-demotion
  if (id === req.user.id && role === 'student') {
    return res.status(400).json({ error: 'You cannot demote yourself.' });
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', id)
    .select('id, full_name, role')
    .single();

  if (error) return res.status(400).json({ error: 'Failed to update role.' });

  logAudit(req.user.id, 'SET_USER_ROLE', {
    target_user_id: id,
    user_name: data.full_name,
    new_role: role,
    changed_by_role: actorRole
  });

  // Targeted notification for the user whose role was updated
  createNotification({
    userId: id,
    targetRole: 'all',
    type: 'system',
    title: `🎓 Account Status Updated`,
    message: `Your account role has been set to ${role.toUpperCase()}.`,
    category: 'units',
    link: 'units',
    metadata: { new_role: role }
  });

  res.json(data);
});

// ── POST /api/admin/users/:id/verify ─────────────────────────────────────────
// Officers, Governors, and Admins can verify/approve user accounts and dispatch an automated Gmail email notification.
router.post('/users/:id/verify', requireOfficer, async (req, res) => {
  const { id } = req.params;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid user ID format.' });
  }

  // Update profile to set is_verified = true
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_verified: true })
    .eq('id', id)
    .select('id, full_name, email, role, is_verified')
    .single();

  if (error || !data) {
    logError('Verify User Error', error);
    return res.status(400).json({ error: 'Failed to verify user account.' });
  }

  // Dispatch approval email notification asynchronously via Brevo / Gmail
  sendAccountApprovalEmail(data.email, data.full_name).catch(err => {
    logError('Async Approval Email Error', err);
  });

  // Audit logging
  logAudit(req.user.id, 'VERIFY_USER_ACCOUNT', {
    target_user_id: id,
    user_name: data.full_name,
    user_email: data.email,
    verified_by: req.user.id
  });

  // In-App Notification
  createNotification({
    userId: id,
    targetRole: 'all',
    type: 'system',
    title: `🎉 Account Verified!`,
    message: `Your account has been officially verified by the admin. You can now access all portal features.`,
    category: 'system',
    link: 'dashboard'
  });

  res.json({
    message: `User account verified successfully. Approval notification dispatched to ${data.email}.`,
    user: data
  });
});

// ── POST /api/admin/send-approval-email ─────────────────────────────────────
// Dispatches an account approval notification email directly to an email address
router.post('/send-approval-email', requireOfficer, async (req, res) => {
  const { email, full_name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  // Update profile by email if profile exists
  try {
    await supabase
      .from('profiles')
      .update({ is_verified: true })
      .eq('email', email);
  } catch (err) {
    /* non-fatal */
  }

  const result = await sendAccountApprovalEmail(email, full_name || 'COE Member');
  res.json({ message: 'Approval email dispatched.', result });
});

// ── GET /api/admin/audit-logs (readable by all officers) ─────────────────────
router.get('/audit-logs', requireOfficer, async (req, res) => {
  const limit  = Math.min(Number(req.query.limit)  || 50, 100);
  const offset = Math.min(Number(req.query.offset) || 0, 10000);

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logError('Audit Log Error', error);
    return res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }

  // Manual join for profiles to bypass missing FK relationships (only query valid UUIDs)
  const userIds = [...new Set(logs.map(l => l.user_id).filter(isValidUUID))];
  
  // Collect detailed enrichment IDs
  const targetUserIds = [...new Set(logs.map(l => l.details?.target_user_id).filter(isValidUUID))];
  const allProfileIds = [...new Set([...userIds, ...targetUserIds])];

  // Only query valid UUIDs in events table; non-UUID identifiers like 'GENERAL' represent the General Fund
  const eventIds = [...new Set(logs.flatMap(l => {
    const d = l.details || {};
    return [d.event_id, d.from_event_id, d.to_event_id].filter(isValidUUID);
  }))];

  let profilesMap = {};
  let eventsMap = {};

  const fetches = [];
  if (allProfileIds.length > 0) {
    fetches.push(supabase.from('profiles').select('id, full_name, email').in('id', allProfileIds).then(({ data }) => {
      if (data) data.forEach(p => profilesMap[p.id] = p);
    }));
  }
  if (eventIds.length > 0) {
    fetches.push(supabase.from('events').select('id, event_name').in('id', eventIds).then(({ data }) => {
      if (data) data.forEach(e => eventsMap[e.id] = e.event_name);
    }));
  }

  await Promise.all(fetches);

  const mergedData = logs.map(log => {
    const d = { ...(log.details || {}) };
    
    // Inject names if missing but ID exists (resolve 'GENERAL' to 'General Fund')
    if (d.event_id === 'GENERAL') d.event_name = d.event_name || 'General Fund';
    else if (d.event_id && !d.event_name) d.event_name = eventsMap[d.event_id];

    if (d.from_event_id === 'GENERAL') d.from_event_name = d.from_event_name || 'General Fund';
    else if (d.from_event_id && !d.from_event_name) d.from_event_name = eventsMap[d.from_event_id];

    if (d.to_event_id === 'GENERAL') d.to_event_name = d.to_event_name || 'General Fund';
    else if (d.to_event_id && !d.to_event_name) d.to_event_name = eventsMap[d.to_event_id];

    if (d.target_user_id && !d.user_name) d.user_name = profilesMap[d.target_user_id]?.full_name;

    return {
      ...log,
      profiles: profilesMap[log.user_id] || null,
      details: d
    };
  });

  res.json(mergedData);
});

// ── POST /api/admin/budget-transfer ──────────────────────────────────────────
router.post('/budget-transfer', requireGovernorOrAdmin, async (req, res) => {
  const { from_event_id, to_event_id, amount, reason } = req.body;

  if (!from_event_id || !to_event_id) {
    return res.status(400).json({ error: 'Both source and target events are required.' });
  }
  if (from_event_id === to_event_id) {
    return res.status(400).json({ error: 'Source and target events must be different.' });
  }
  if (!isValidUUID(to_event_id)) {
    return res.status(400).json({ error: 'Target event must be a valid event ID.' });
  }
  if (from_event_id !== 'GENERAL' && !isValidUUID(from_event_id)) {
    return res.status(400).json({ error: 'Source event must be a valid event ID or General Fund.' });
  }
  if (!isPositiveNumber(amount)) {
    return res.status(400).json({ error: 'Amount must be a positive number.' });
  }
  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'A reason of at least 5 characters is required.' });
  }

  const transferAmount = Number(amount);

  let fromEventName = "General Fund";
  let toEventName   = "";

  // ── CASE 1: Transfer from General Fund ──────────────────────────────
  if (from_event_id === 'GENERAL') {
    const [{ data: txs, error: txErr }, { data: events, error: evErr }, { data: targetEv, error: te }] = await Promise.all([
      supabase.from('transactions').select('type, amount, use_allocation'),
      supabase.from('events').select('allocated_budget'),
      supabase.from('events').select('id, event_name, allocated_budget, remaining_budget, status').eq('id', to_event_id).single(),
    ]);

    if (txErr || evErr) return res.status(500).json({ error: 'Failed to compute general fund balance.' });
    if (te || !targetEv) return res.status(404).json({ error: 'Target event not found.' });
    if (targetEv.status === 'archived') return res.status(400).json({ error: 'Cannot transfer to an archived event.' });

    toEventName = targetEv.event_name;

    // Compute Available General Fund
    // Logic: Total Incomes - Dashboard Expenses - Reserved Envelopes
    const summary = (txs || []).reduce((acc, tx) => {
      if (['donation', 'collection', 'allocation'].includes(tx.type)) {
        acc.income += Number(tx.amount);
      }
      // Track dashboard-impacting expenses
      if (tx.type === 'expense' && !tx.use_allocation) {
        acc.dashboard_expense += Number(tx.amount);
      }

      // Explicitly exclude internal 'transfer' from totalIncome summing
      // but keep it in breakdown for ledger awareness
      return acc;
    }, { expense: 0, donation: 0, collection: 0, allocation: 0, transfer: 0, dashboard_expense: 0 });

    const totalReserved = (events || []).reduce((sum, e) => sum + Number(e.allocated_budget), 0);
    const availableBalance = summary.income - summary.dashboard_expense - totalReserved;

    if (transferAmount > availableBalance) {
      return res.status(400).json({ 
        error: `Insufficient unreserved funds in General Fund. Available: ₱${availableBalance.toLocaleString()}.` 
      });
    }

  } 
  // ── CASE 2: Transfer from another Event ─────────────────────────────
  else {
    const [{ data: fromEv, error: fe }, { data: toEv, error: te }] = await Promise.all([
      supabase.from('events').select('id, event_name, remaining_budget, status').eq('id', from_event_id).single(),
      supabase.from('events').select('id, event_name, remaining_budget, status').eq('id', to_event_id).single(),
    ]);

    if (fe || !fromEv) return res.status(404).json({ error: 'Source event not found.' });
    if (te || !toEv)   return res.status(404).json({ error: 'Target event not found.' });

    fromEventName = fromEv.event_name;
    toEventName   = toEv.event_name;

    if (fromEv.status === 'archived') return res.status(400).json({ error: 'Cannot transfer from an archived event.' });
    if (Number(fromEv.remaining_budget) < transferAmount) {
      return res.status(400).json({ error: `Insufficient remaining budget in "${fromEv.event_name}". Available: ₱${Number(fromEv.remaining_budget).toLocaleString()}.` });
    }
  }

  // ── SHARED: Record paired transfer transactions and Audit ─────────
  const today = new Date().toISOString().split('T')[0];
  const cleanReason = sanitizeText(reason);
  const sourceEventId = from_event_id === 'GENERAL' ? null : from_event_id;

  const { error: insErr } = await supabase.from('transactions').insert([
    {
      event_id:         sourceEventId,
      type:             'transfer',
      direction:        'out',
      amount:           transferAmount,
      description:      `Budget transfer to "${toEventName}": ${cleanReason}`,
      added_by:         req.user.id,
      transaction_date: today,
    },
    {
      event_id:         to_event_id,
      type:             'transfer',
      direction:        'in',
      amount:           transferAmount,
      description:      `Budget transfer from "${fromEventName}": ${cleanReason}`,
      added_by:         req.user.id,
      transaction_date: today,
    }
  ]);

  if (insErr) {
    logError('Budget Transfer Insert Error', insErr);
    return res.status(500).json({ error: 'Failed to record budget transfer transactions.' });
  }

  logAudit(req.user.id, 'BUDGET_TRANSFER', {
    from_event_id,
    from_event_name: fromEventName,
    to_event_id,
    to_event_name:   toEventName,
    amount:          transferAmount,
    reason:          cleanReason,
  });

  res.json({
    message: `Successfully transferred ₱${transferAmount.toLocaleString()} from "${fromEventName}" to "${toEventName}".`
  });
});

// ── PATCH /api/admin/events/:id/archive ──────────────────────────────────────
router.patch('/events/:id/archive', requireGovernorOrAdmin, async (req, res) => {
  const { id } = req.params;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }

  const { data: ev, error: evErr } = await supabase
    .from('events')
    .select('id, event_name, status')
    .eq('id', id)
    .single();

  if (evErr || !ev) return res.status(404).json({ error: 'Event not found.' });
  if (ev.status === 'archived') return res.status(400).json({ error: 'Event is already archived.' });

  const { data, error } = await supabase
    .from('events')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: 'Failed to archive event.' });

  logAudit(req.user.id, 'ARCHIVE_EVENT', { event_id: id, event_name: ev.event_name });
  res.json(data);
});

// ── POST /api/admin/backfill-approval-emails ────────────────────────────────
// Triggers verification/approval emails in minimalist COE Orange theme to all
// verified student accounts and approved verification requests.
router.post('/backfill-approval-emails', requireOfficer, async (req, res) => {
  try {
    const { data: verifiedProfiles } = await supabase
      .from('profiles')
      .select('email, full_name, role, is_verified')
      .neq('role', 'admin')
      .or('email.ilike.%@gmail.com,email.ilike.%@g.cjc.edu.ph');

    const { data: approvedRequests } = await supabase
      .from('enrollment_verification_requests')
      .select('email, full_name, status')
      .eq('status', 'approved')
      .or('email.ilike.%@gmail.com,email.ilike.%@g.cjc.edu.ph');

    const recipientsMap = new Map();

    (verifiedProfiles || []).forEach(p => {
      if (p.email && (p.is_verified === true || p.is_verified === undefined)) {
        recipientsMap.set(p.email.trim().toLowerCase(), {
          email: p.email.trim(),
          name: p.full_name || 'COE Member'
        });
      }
    });

    (approvedRequests || []).forEach(r => {
      if (r.email) {
        const em = r.email.trim().toLowerCase();
        if (!recipientsMap.has(em)) {
          recipientsMap.set(em, {
            email: r.email.trim(),
            name: r.full_name || 'COE Member'
          });
        }
      }
    });

    const recipients = Array.from(recipientsMap.values());
    let sentCount = 0;
    let failCount = 0;

    for (const item of recipients) {
      const emailRes = await sendAccountApprovalEmail(item.email, item.name);
      if (emailRes && emailRes.sent > 0) {
        sentCount++;
      } else {
        failCount++;
      }
    }

    logAudit(req.user.id, 'BACKFILL_APPROVAL_EMAILS', { total: recipients.length, sent: sentCount, failed: failCount });
    res.json({
      success: true,
      message: `Dispatched approval emails to ${sentCount} account(s).`,
      total: recipients.length,
      sent: sentCount,
      failed: failCount
    });
  } catch (err) {
    logError('admin/backfill-approval-emails', err);
    res.status(500).json({ error: 'Failed to dispatch backfill verification emails.' });
  }
});

module.exports = router;
