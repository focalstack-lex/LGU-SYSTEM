// =============================================
// server/lib/email.js - Brevo API Helper
// =============================================
const SibApiV3Sdk = require('sib-api-v3-sdk');
const supabase = require('./supabase');
const { logError } = require('./logger');

const APP_URL = process.env.APP_URL || 'https://coelgu-system.engineer';

// Lazy init Brevo client
let _brevoApi = null;
function getBrevoApi() {
  if (!_brevoApi) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      console.warn('[Email] Skipping: BREVO_API_KEY missing. Please add it to Render Environment settings.');
      return null;
    }

    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKeyInstance = defaultClient.authentications['api-key'];
    apiKeyInstance.apiKey = apiKey;

    _brevoApi = new SibApiV3Sdk.TransactionalEmailsApi();
    defaultClient.timeout = 10000;
  }
  return _brevoApi;
}

/**
 * Fetches all registered student emails via the profiles table.
 * Specifically filters for Gmail/Google Workspace accounts.
 */
async function getAllStudentEmails() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('email')
      .neq('role', 'admin')
      .or('email.ilike.%@gmail.com,email.ilike.%@g.cjc.edu.ph');

    if (error) throw error;
    
    return (data || []).map(p => p.email).filter(Boolean);
  } catch (err) {
    console.error('[Email] Failed to fetch student emails:', err.message);
    return [];
  }
}

/**
 * Wraps email contents into an official institutional COE Redesign template.
 * Minimalist, high-contrast, document-style layout without unnecessary cards or glows.
 */
function buildEmailTemplate({ subject, preheader, content }) {
  const logoUrl = `${APP_URL}/assets/coe-logo.png`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;-webkit-font-smoothing:antialiased;color:#0F172A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Institutional Container: Clean 1px border, 8px radius, NO box shadow -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
          
          <!-- Official COE Institutional Header -->
          <tr>
            <td style="background:#121214;padding:20px 24px;border-bottom:3px solid #FF5533;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="46" style="vertical-align:middle;">
                    <img src="${logoUrl}" alt="COE Logo" width="42" height="42" style="display:block;width:42px;height:42px;border-radius:50%;object-fit:contain;background:#1C1C20;border:1px solid rgba(255,255,255,0.2);" />
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;text-align:left;">
                    <span style="color:#A1A1AA;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:2px;">COR JESU COLLEGE</span>
                    <h1 style="margin:0;color:#FFFFFF;font-size:16px;font-weight:700;line-height:1.2;">College of Engineering</h1>
                    <span style="color:#FF5533;font-size:11px;font-weight:600;display:block;margin-top:2px;">Local Government Unit & Academic Portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Email Body -->
          <tr>
            <td style="padding:28px 24px;text-align:left;background:#FFFFFF;">
              ${content}
            </td>
          </tr>

          <!-- Department Footer -->
          <tr>
            <td style="background:#FFFFFF;border-top:1px solid #E2E8F0;padding:20px 24px;text-align:left;">
              <p style="margin:0 0 3px;font-size:12px;color:#0F172A;font-weight:700;">
                College of Engineering Local Government Unit
              </p>
              <p style="margin:0;font-size:11px;color:#64748B;">
                Cor Jesu College, Inc. • Sacred Heart Avenue, Digos City
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-footer Automated Notice -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:12px auto 0;">
          <tr>
            <td align="left" style="padding:0 4px;">
              <p style="margin:0;font-size:11px;color:#94A3B8;line-height:1.4;">
                This is an official automated notification from the COE Academic & Transparency Portal.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Sends an announcement notification email via Brevo API (HTTP).
 */
async function sendAnnouncementEmail(title, body) {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0 };

    const emails = await getAllStudentEmails();
    if (!emails.length) return { sent: 0 };

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `[COE LGU] ${title}`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: `Announcement: ${title}`,
      preheader: body.slice(0, 100),
      content: `
        <div style="margin-bottom:16px;padding-left:12px;border-left:3px solid #FF5533;">
          <span style="display:block;font-size:10px;font-weight:700;color:#64748B;letter-spacing:1px;text-transform:uppercase;">NOTICE</span>
          <span style="font-size:14px;font-weight:700;color:#FF5533;">ANNOUNCEMENT</span>
        </div>
        <h2 style="margin:0 0 12px;color:#0F172A;font-size:18px;font-weight:700;line-height:1.3;">${title}</h2>
        <div style="margin-bottom:20px;border-top:1px solid #E2E8F0;padding-top:14px;">
          <p style="margin:0;color:#334155;line-height:1.6;white-space:pre-wrap;font-size:14px;">${body}</p>
        </div>
        <div style="margin-top:24px;">
          <a href="${APP_URL}" style="display:inline-block;background:#FF5533;color:#FFFFFF;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open Portal</a>
        </div>
      `
    });

    sendSmtpEmail.sender = { 
      name: "COE Financial Transparency System", 
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" 
    };
    
    sendSmtpEmail.to = [{ email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" }];
    sendSmtpEmail.bcc = emails.map(email => ({ email }));

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Announcement sent via Brevo: ${data.messageId}`);
    return { sent: emails.length };
  } catch (err) {
    logError('Email Announcement Error', err);
    return { sent: 0, error: err.message };
  }
}

/**
 * Sends a new event notification email via Brevo API (HTTP).
 */
async function sendNewEventEmail(event) {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0 };

    const emails = await getAllStudentEmails();
    if (!emails.length) return { sent: 0 };

    const formattedDate = event.event_date 
      ? new Date(event.event_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;

    const formattedBudget = Number(event.allocated_budget || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `New Event: ${event.event_name}`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: `New Event: ${event.event_name}`,
      preheader: `A new event has been scheduled: ${event.event_name}.`,
      content: `
        <div style="margin-bottom:16px;padding-left:12px;border-left:3px solid #0284C7;">
          <span style="display:block;font-size:10px;font-weight:700;color:#64748B;letter-spacing:1px;text-transform:uppercase;">EVENT</span>
          <span style="font-size:14px;font-weight:700;color:#0284C7;">NEW EVENT SCHEDULED</span>
        </div>
        <h2 style="margin:0 0 6px;color:#0F172A;font-size:18px;font-weight:700;line-height:1.3;">${event.event_name}</h2>
        <p style="margin:0 0 16px;color:#64748B;font-size:13px;">A new event has been posted to the council calendar.</p>

        <div style="margin-bottom:20px;border-top:1px solid #E2E8F0;padding-top:14px;text-align:left;">
          ${formattedDate ? `
            <div style="margin-bottom:12px;">
              <span style="display:block;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Scheduled Date</span>
              <span style="font-size:14px;font-weight:600;color:#0F172A;">${formattedDate}</span>
            </div>
          ` : ''}
          <div style="margin-bottom:${event.description ? '12px' : '0'};">
            <span style="display:block;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Allocated Budget</span>
            <span style="font-size:16px;font-weight:700;color:#FF5533;">PHP ${formattedBudget}</span>
          </div>
          ${event.description ? `
            <div style="border-top:1px solid #F1F5F9;padding-top:12px;margin-top:12px;">
              <span style="display:block;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Description</span>
              <p style="margin:0;font-size:13px;color:#334155;line-height:1.5;">${event.description}</p>
            </div>
          ` : ''}
        </div>

        <div style="margin-top:24px;">
          <a href="${APP_URL}" style="display:inline-block;background:#FF5533;color:#FFFFFF;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">View Event Details</a>
        </div>
      `
    });

    sendSmtpEmail.sender = { 
      name: "COE Financial Transparency System", 
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" 
    };
    
    sendSmtpEmail.to = [{ email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" }];
    sendSmtpEmail.bcc = emails.map(email => ({ email }));

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Event notification sent via Brevo: ${data.messageId}`);
    return { sent: emails.length };
  } catch (err) {
    logError('Email Event Notification Error', err);
    return { sent: 0, error: err.message };
  }
}

/**
 * Sends an account approval notification email via Brevo API (HTTP).
 */
async function sendAccountApprovalEmail(userEmail, userName = 'COE Member') {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0, reason: 'Brevo API key missing' };
    if (!userEmail) return { sent: 0, reason: 'No recipient email provided' };

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `Account Verified: COE LGU Portal`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: `Account Verified`,
      preheader: `Your account has been verified by the admin. You can now log into the portal.`,
      content: `
        <div style="margin-bottom:16px;padding-left:12px;border-left:3px solid #16A34A;">
          <span style="display:block;font-size:10px;font-weight:700;color:#64748B;letter-spacing:1px;text-transform:uppercase;">ACCOUNT</span>
          <span style="font-size:14px;font-weight:700;color:#16A34A;">VERIFIED & ACTIVE</span>
        </div>
        <h2 style="margin:0 0 8px;color:#0F172A;font-size:18px;font-weight:700;line-height:1.3;text-align:left;">Welcome, ${userName}</h2>
        <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;text-align:left;">Your account has been verified by the council administration. You may now log in to access the COE student & academic portal.</p>
        <div style="margin-top:24px;">
          <a href="${APP_URL}" style="display:inline-block;background:#FF5533;color:#FFFFFF;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Log In to Portal</a>
        </div>
      `
    });

    sendSmtpEmail.sender = {
      name: "COE Financial Transparency System",
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com"
    };
    sendSmtpEmail.to = [{ email: userEmail, name: userName }];

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Approval email sent to ${userEmail} via Brevo: ${data.messageId}`);
    return { sent: 1, messageId: data.messageId };
  } catch (err) {
    logError('Email Approval Notification Error', err);
    return { sent: 0, error: err.message };
  }
}

/**
 * Sends an enrollment status email to a student via Brevo API (HTTP).
 * Minimalist institutional format with clean left-accent status lines.
 */
async function sendLoadStatusEmail({ to, name = 'COE Student', status, milestone, studentName, term, lines = [], changes = null }) {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0, reason: 'Brevo API key missing' };
    if (!to) return { sent: 0, reason: 'No recipient email provided' };

    const statusConfig = {
      approved: { label: 'LOAD VERIFIED', color: '#16A34A' },
      encoded:  { label: 'LOAD ENCODED', color: '#FF5533' },
      returned: { label: 'LOAD RETURNED', color: '#D97706' },
      rejected: { label: 'LOAD REJECTED', color: '#DC2626' },
    };

    const phase = milestone === 'encoded' ? 'encoded' : (status === 'approved' ? 'verified' : status);
    const cfg = statusConfig[phase] || statusConfig[status] || { label: 'LOAD UPDATE', color: '#FF5533' };

    const heading = phase === 'verified'
      ? `Your Program Head has <strong>verified</strong> your load for <strong>${term}</strong>.`
      : phase === 'encoded'
        ? `Your submitted load for <strong>${term}</strong> was <strong>Load Encoded</strong>.`
        : `Your load for <strong>${term}</strong> has been marked ${cfg.label.toLowerCase()}.`;
    const subline = phase === 'verified'
      ? 'These are the final subjects you will enroll this semester.'
      : phase === 'encoded'
        ? 'Your enrollment inside this system is complete. The next step — assessment and claiming — happens at the University Registrar, outside this system.'
        : '';
    const listHeader = phase === 'encoded' ? 'Encoded Course Load' : (phase === 'verified' ? 'Final Verified Course Load' : 'Submitted Course Load');

    const changeHtml = changes && changes.length
      ? `<div style="margin:16px 0;padding:12px;border-left:3px solid #D97706;background:#FFFBEB;text-align:left;">
           <div style="font-size:11px;font-weight:700;color:#B45309;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Changes by Program Head</div>
           <ul style="margin:0;padding-left:18px;color:#78350F;font-size:13px;line-height:1.5;">${changes.map(c => `<li style="margin-bottom:3px;">${c}</li>`).join('')}</ul>
         </div>`
      : '';

    const listHtml = lines && lines.length
      ? `<div style="margin:20px 0 24px;border-top:1px solid #E2E8F0;padding-top:16px;text-align:left;">
           <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;">${listHeader}</div>
           <table width="100%" cellpadding="0" cellspacing="0" border="0">
             ${lines.map(l => `
               <tr>
                 <td style="padding:5px 0;color:#1E293B;font-size:13px;line-height:1.5;">
                   <span style="color:#FF5533;font-weight:700;margin-right:8px;">•</span> ${l}
                 </td>
               </tr>
             `).join('')}
           </table>
         </div>`
      : '';

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `[COE Portal] ${cfg.label} - ${term}`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: `${cfg.label}: COE LGU Portal`,
      preheader: `${studentName} — load for ${term}`,
      content: `
        <div style="margin-bottom:16px;padding-left:12px;border-left:3px solid ${cfg.color};text-align:left;">
          <span style="display:block;font-size:10px;font-weight:700;color:#64748B;letter-spacing:1px;text-transform:uppercase;">ENROLLMENT STATUS</span>
          <span style="font-size:14px;font-weight:700;color:${cfg.color};">${cfg.label}</span>
        </div>
        <p style="margin:0 0 8px;color:#0F172A;font-size:15px;font-weight:600;text-align:left;">Hi ${studentName},</p>
        <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;text-align:left;">${heading}</p>
        ${subline ? `<p style="margin:0 0 14px;color:#64748B;font-size:13px;line-height:1.6;text-align:left;">${subline}</p>` : ''}
        ${changeHtml}
        ${listHtml}
        <div style="margin-top:24px;">
          <a href="${APP_URL}" style="display:inline-block;background:#FF5533;color:#FFFFFF;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open the portal</a>
        </div>`
    });

    sendSmtpEmail.sender = {
      name: "COE Financial Transparency System",
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com"
    };
    sendSmtpEmail.to = [{ email: to, name }];

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Load status email (${phase}) sent to ${to} via Brevo: ${data.messageId}`);
    return { sent: 1, messageId: data.messageId };
  } catch (err) {
    logError('Email Load Status Error', err);
    return { sent: 0, error: err.message };
  }
}

module.exports = { buildEmailTemplate, sendAnnouncementEmail, sendNewEventEmail, sendAccountApprovalEmail, sendLoadStatusEmail };
