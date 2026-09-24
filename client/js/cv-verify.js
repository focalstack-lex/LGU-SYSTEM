// ==========================================================================
// cv-verify.js - Public Credential Verification View
// All API-sourced values are escaped before insertion.
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  'use strict';
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const container = document.getElementById('verify-container');

  if (!container) return;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  if (!token) {
    container.innerHTML = `
      <div style="text-align: center;">
        <iconify-icon icon="solar:danger-circle-bold" style="font-size: 3rem; color: #ef4444;"></iconify-icon>
        <h2>Invalid Verification Link</h2>
        <p style="color: #64748b;">No verification token provided.</p>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/cv/verify/${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error('Verification failed');

    const data = await res.json();

    container.innerHTML = `
      <div class="verify-badge">
        <iconify-icon icon="solar:verified-check-bold"></iconify-icon>
        OFFICIALLY VERIFIED STUDENT CREDENTIALS
      </div>

      <h1 class="student-name">${esc(data.student_name)}</h1>
      <div class="student-course">${esc(data.course)} &bull; Candidate ${data.enrollment_year ? esc(Number(data.enrollment_year) + 4) : ''}</div>
      <p style="font-size: 0.9rem; color: #475569; margin-bottom: 20px;">${esc(data.headline || 'College of Engineering Student')}</p>

      <h3 style="font-size: 1rem; font-weight: 700; margin-bottom: 8px;">College Verified Achievements & Roles</h3>

      <div class="meta-row">
        <span>Verified Identity:</span>
        <strong>${esc(data.student_name)} (${esc(data.course)})</strong>
      </div>
      <div class="meta-row">
        <span>Curriculum Standing:</span>
        <strong>Official Batch ${esc(data.enrollment_year || 'N/A')}</strong>
      </div>
      <div class="meta-row">
        <span>Verification Timestamp:</span>
        <strong>${esc(data.verified_at ? new Date(data.verified_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Active Record')}</strong>
      </div>
      <div class="meta-row">
        <span>Institutional Authority:</span>
        <strong>Cor Jesu College - College of Engineering</strong>
      </div>

      <div class="security-seal">
        <iconify-icon icon="solar:shield-check-bold" style="font-size: 1.5rem; color: #16a34a;"></iconify-icon>
        <div>
          <strong style="color: #15803d; display: block; font-size: 0.85rem;">Cryptographically Signed Record</strong>
          <span style="font-size: 0.75rem; color: #64748b;">This profile has been verified against the official COE student database records.</span>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `
      <div style="text-align: center;">
        <iconify-icon icon="solar:close-circle-bold" style="font-size: 3rem; color: #ef4444;"></iconify-icon>
        <h2>Verification Record Not Found</h2>
        <p style="color: #64748b;">This certificate is invalid, revoked, or has expired.</p>
      </div>
    `;
  }
});
