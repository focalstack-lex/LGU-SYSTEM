// =============================================
// client/js/reports.js - Phase 3 Reporting
// =============================================

let _monthlyChart = null;
let _breakdownChart = null;
let _lastMonthlyData = null;
let _lastSummaryBreakdownData = null;

// Shimmer skeleton that mirrors the reports layout (stat cards, charts,
// event table) while the API calls are in flight. Reuses the global .sk-*
// system, which already adapts the grids between desktop and mobile.
function reportsSkeleton() {
  return `
    <div class="sk-reports" aria-hidden="true">
      <!-- Summary stat cards -->
      <div class="sk-stats-grid">
        ${[0, 1, 2, 3].map(() => `
          <div class="sk-stat-card">
            <div class="sk-bone sk-circle" style="width:38px;height:38px;flex-shrink:0;"></div>
            <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
              <div class="sk-bone" style="height:10px;width:60%;border-radius:4px;"></div>
              <div class="sk-bone" style="height:22px;width:80%;border-radius:5px;"></div>
            </div>
          </div>`).join('')}
      </div>

      <!-- Charts row -->
      <div class="sk-cards-grid">
        <div class="sk-content-card">
          <div class="sk-bone" style="height:14px;width:45%;border-radius:4px;margin-bottom:18px;"></div>
          <div class="sk-bone sk-chart"></div>
        </div>
        <div class="sk-content-card">
          <div class="sk-bone" style="height:14px;width:40%;border-radius:4px;margin-bottom:18px;"></div>
          <div class="sk-bone sk-chart"></div>
        </div>
      </div>

      <!-- Event reports table -->
      <div class="sk-content-card">
        <div class="sk-bone" style="height:14px;width:30%;border-radius:4px;margin-bottom:18px;"></div>
        <div class="sk-bone sk-list-row"></div>
        <div class="sk-bone sk-list-row"></div>
        <div class="sk-bone sk-list-row"></div>
        <div class="sk-bone sk-list-row"></div>
        <div class="sk-bone sk-list-row" style="width:70%;"></div>
      </div>
    </div>`;
}

async function initReports() {
  const container = document.getElementById('reports-content');
  if (!container) return;

  const hasCached = Api.hasCache('/reports/summary') && Api.hasCache('/reports/monthly') && Api.hasCache('/reports/events-summary');
  if (!hasCached && (!container.children.length || container.querySelector('.empty-state') || container.querySelector('.sk-reports'))) {
    container.innerHTML = reportsSkeleton();
  }

  try {
    const [summary, monthly, events] = await Promise.all([
      Api.reports.summary(),
      Api.reports.monthly(),
      Api.reports.eventsSummary(),
    ]);

    container.innerHTML = buildReportsHTML(summary, monthly, events);

    // Cache data for dynamic redrawing on theme changes
    _lastMonthlyData = monthly;
    _lastSummaryBreakdownData = summary.breakdown;

    // CRITICAL: re-create Lucide icons after dynamic HTML injection
    // Render charts after DOM is ready
    requestAnimationFrame(() => {
      renderMonthlyChart(monthly);
      renderBreakdownChart(summary.breakdown);
    });

    // Wire up range filter dropdown if present in the header
    const rangeFilter = document.getElementById('reports-range-filter');
    if (rangeFilter && !rangeFilter.dataset.bound) {
      rangeFilter.dataset.bound = 'true';
      rangeFilter.addEventListener('change', () => {
        const val = rangeFilter.value;
        let filteredMonthly = _lastMonthlyData || monthly;
        if (val === 'month') filteredMonthly = filteredMonthly.slice(-1);
        else if (val === 'semester') filteredMonthly = filteredMonthly.slice(-6);
        else if (val === 'year') filteredMonthly = filteredMonthly.slice(-12);
        renderMonthlyChart(filteredMonthly);
      });
    }

    // Wire up download buttons
    container.querySelectorAll('[data-pdf]').forEach(btn => {
      btn.addEventListener('click', () => downloadReport('pdf', btn.dataset.pdf, btn.dataset.name));
    });
    container.querySelectorAll('[data-excel]').forEach(btn => {
      btn.addEventListener('click', () => downloadReport('excel', btn.dataset.excel, btn.dataset.name));
    });

  } catch (err) {
    const isSessionErr = err.message.includes('session');
    container.innerHTML = `
      <div class="empty-state">
        <iconify-icon icon="solar:danger-triangle-linear" style="font-size:48px; color:var(--col-danger); margin-bottom:1rem"></iconify-icon>
        <p style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;">${isSessionErr ? 'Session Expired' : 'Failed to Load Reports'}</p>
        <p style="color:var(--col-text-muted);margin-bottom:1.5rem;max-width:300px;margin-left:auto;margin-right:auto;">
          ${err.message}
        </p>
        ${isSessionErr 
          ? `<button class="btn btn-primary" onclick="Auth.logout()">Sign In Again</button>` 
          : `<button class="btn btn-ghost" onclick="Reports.load()">Retry</button>`}
      </div>`;
}
}

function fmt(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function buildReportsHTML(summary, monthly, events) {
  const utilized = summary.totalIncome > 0
    ? Math.round((summary.totalExpense / summary.totalIncome) * 100)
    : 0;

  return `
    <!-- Summary Cards -->
    <div class="stats-grid" style="margin-bottom:2rem;">
      <div class="stat-card stat-income">
        <div class="stat-icon"><iconify-icon icon="solar:chart-2-linear"></iconify-icon></div>
        <div class="stat-body"><p class="stat-label">Total Income</p><h3 class="stat-value">${fmt(summary.totalIncome)}</h3></div>
      </div>
      <div class="stat-card stat-expense">
        <div class="stat-icon"><iconify-icon icon="solar:chart-square-linear"></iconify-icon></div>
        <div class="stat-body"><p class="stat-label">Total Expenses</p><h3 class="stat-value">${fmt(summary.totalExpense)}</h3></div>
      </div>
      <div class="stat-card stat-balance">
        <div class="stat-icon"><iconify-icon icon="solar:wallet-2-linear"></iconify-icon></div>
        <div class="stat-body">
          <p class="stat-label">Available General Fund</p>
          <h3 class="stat-value">${fmt(summary.remainingBalance)}</h3>
          <p class="stat-sublabel" style="font-size:0.75rem;color:var(--text-secondary)">Net Cash: ${fmt(summary.totalIncome - summary.totalExpense)}</p>
        </div>
      </div>
      <div class="stat-card stat-donations">
        <div class="stat-icon"><iconify-icon icon="solar:pie-chart-2-linear"></iconify-icon></div>
        <div class="stat-body">
          <p class="stat-label">Budget Utilized</p>
          <h3 class="stat-value">${utilized}%</h3>
          <div class="reports-util-track">
            <div class="reports-util-fill" style="width:${Math.min(utilized, 100)}%;"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="dashboard-grid" style="margin-bottom:2rem;">
      <div class="dashboard-card">
        <h3><iconify-icon icon="solar:chart-linear" style="font-size:1.1rem; margin-right:.4rem; vertical-align:middle"></iconify-icon>Monthly Income vs Expenses</h3>
        <div style="position:relative;height:260px;">
          <canvas id="monthly-chart"></canvas>
        </div>
      </div>
      <div class="dashboard-card">
        <h3><iconify-icon icon="solar:pie-chart-linear" style="font-size:1.1rem; margin-right:.4rem; vertical-align:middle"></iconify-icon>Breakdown by Type</h3>
        <div style="position:relative;height:260px;">
          <canvas id="breakdown-chart"></canvas>
        </div>
      </div>
    </div>

    <!-- Event Reports Table -->
    <div class="dashboard-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h3 style="margin:0;"><iconify-icon icon="solar:document-text-linear" style="font-size:1.1rem; margin-right:.4rem; vertical-align:middle"></iconify-icon>Export Per-Event Reports</h3>
        <span style="font-size:.8rem;color:var(--text-secondary);">Admin only</span>
      </div>
      ${events.length === 0
        ? `<div class="empty-state"><iconify-icon icon="solar:info-circle-linear"></iconify-icon> No events found.</div>`
        : `<div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Allocated</th>
                <th>Remaining</th>
                <th>Status</th>
                <th style="text-align:center;">Export</th>
              </tr>
            </thead>
            <tbody>
              ${events.map(ev => `
                <tr>
                  <td><strong>${ev.event_name}</strong></td>
                  <td>${fmt(ev.allocated_budget)}</td>
                  <td>${fmt(ev.computed_remaining || 0)}</td>
                  <td>${UI.renderStatusBadge(ev.status)}</td>
                  <td style="text-align:center;">
                    <div style="display:inline-flex;gap:.5rem;">
                      <button class="tx-action-btn admin-only" style="font-size:.8rem;padding:.35rem .8rem;"
                        data-pdf="${ev.id}" data-name="${ev.event_name}">
                        <iconify-icon icon="solar:document-text-linear" style="font-size:.85rem; margin-right:.3rem"></iconify-icon>PDF
                      </button>
                      <button class="tx-action-btn admin-only" style="font-size:.8rem;padding:.35rem .8rem;"
                        data-excel="${ev.id}" data-name="${ev.event_name}">
                        <iconify-icon icon="solar:table-linear" style="font-size:.85rem; margin-right:.3rem"></iconify-icon>Excel
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <!-- Mobile View Cards -->
        <div class="mobile-cards-container">
          ${events.map(ev => `
            <div class="data-card">
              <div class="data-card-header">
                <strong style="font-size:1rem;color:var(--text-primary);">${ev.event_name}</strong>
                ${UI.renderStatusBadge(ev.status)}
              </div>
              
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.25rem;">
                <div>
                  <div style="font-size:0.65rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;">Allocated</div>
                  <div style="font-size:0.9rem;font-weight:600;">${fmt(ev.allocated_budget)}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:0.65rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;">Remaining</div>
                  <div style="font-size:1.1rem;font-weight:800;color:var(--text-primary);">${fmt(ev.computed_remaining || 0)}</div>
                </div>
              </div>

              <div class="data-card-actions" style="margin-top:1rem;padding-top:0.5rem;gap:0.4rem;">
                <button class="tx-action-btn admin-only" style="padding:0.4rem 0.75rem;font-size:0.8rem;" data-pdf="${ev.id}" data-name="${ev.event_name}">
                  <iconify-icon icon="solar:document-text-linear"></iconify-icon> PDF
                </button>
                <button class="tx-action-btn admin-only" style="padding:0.4rem 0.75rem;font-size:0.8rem;" data-excel="${ev.id}" data-name="${ev.event_name}">
                  <iconify-icon icon="solar:table-linear"></iconify-icon> Excel
                </button>
              </div>
            </div>
          `).join('')}
        </div>`
      }
    </div>
  `;
}

function getThemeColor(varName, fallback) {
  const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return color || fallback;
}

function renderMonthlyChart(monthly) {
  const canvas = document.getElementById('monthly-chart');
  if (!canvas || !window.Chart) return;
  if (_monthlyChart) _monthlyChart.destroy();

  const isMobile = window.innerWidth <= 640;
  const labels = monthly.map(m => {
    const [y, mo] = m.month.split('-');
    return isMobile
      ? new Date(y, mo - 1).toLocaleDateString('en-PH', { month: 'short' })
      : new Date(y, mo - 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  });

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const textColor = isLight ? '#64748B' : '#94A3B8';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.04)';
  const tooltipBg = isLight ? '#FFFFFF' : '#0F172A';
  const tooltipText = isLight ? '#0F172A' : '#F8FAFC';
  const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';

  _monthlyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: monthly.map(m => m.income),
          backgroundColor: isLight ? '#059669' : '#10B981',
          hoverBackgroundColor: isLight ? '#047857' : '#059669',
          borderRadius: { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: 'bottom',
          maxBarThickness: isMobile ? 18 : 32,
          categoryPercentage: 0.75,
          barPercentage: 0.85
        },
        {
          label: 'Expenses',
          data: monthly.map(m => m.expense),
          backgroundColor: isLight ? '#DC2626' : '#EF4444',
          hoverBackgroundColor: isLight ? '#B91C1C' : '#F87171',
          borderRadius: { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: 'bottom',
          maxBarThickness: isMobile ? 18 : 32,
          categoryPercentage: 0.75,
          barPercentage: 0.85
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: textColor,
            font: { family: 'Inter, sans-serif', size: isMobile ? 11 : 12, weight: '500' },
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 7,
            boxHeight: 7,
            padding: isMobile ? 10 : 16
          }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipText,
          bodyColor: tooltipText,
          borderColor: tooltipBorder,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleFont: { family: 'Outfit, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Inter, sans-serif', size: 12 },
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ₱${Number(ctx.raw).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
            afterBody: items => {
              const idx = items[0]?.dataIndex;
              if (idx == null || !monthly[idx]) return '';
              const net = (monthly[idx].income || 0) - (monthly[idx].expense || 0);
              return `\nNet Cashflow: ${net >= 0 ? '+' : '-'}₱${Math.abs(net).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
            }
          }
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: textColor,
            font: { family: 'Inter, sans-serif', size: isMobile ? 10 : 11, weight: '500' },
            maxRotation: 0,
            autoSkip: isMobile,
            maxTicksLimit: isMobile ? 6 : 12,
            padding: 6
          }
        },
        y: {
          border: { display: false },
          grid: {
            color: gridColor,
            borderDash: [4, 6],
            drawTicks: false
          },
          ticks: {
            color: textColor,
            font: { family: 'Inter, sans-serif', size: 11 },
            padding: 8,
            callback: v => `₱${(v / 1000).toFixed(0)}k`
          }
        }
      }
    }
  });
}

function renderBreakdownChart(breakdown) {
  const canvas = document.getElementById('breakdown-chart');
  if (!canvas || !window.Chart) return;
  if (_breakdownChart) _breakdownChart.destroy();

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';

  const typeMap = [
    { key: 'expense',    label: 'Expenses',   color: isLight ? '#DC2626' : '#EF4444' },
    { key: 'allocation', label: 'Allocation', color: isLight ? '#4F46E5' : '#6366F1' },
    { key: 'donation',   label: 'Donations',  color: isLight ? '#059669' : '#10B981' },
    { key: 'collection', label: 'Collection', color: isLight ? '#0284C7' : '#0EA5E9' },
  ];

  const active = typeMap.filter(t => (breakdown[t.key] || 0) > 0);
  const hasData = active.length > 0;
  const totalVal = active.reduce((sum, t) => sum + (breakdown[t.key] || 0), 0);

  const labels = hasData
    ? active.map(t => {
        const val = breakdown[t.key] || 0;
        const pct = totalVal > 0 ? Math.round((val / totalVal) * 100) : 0;
        return `${t.label} (${pct}%)`;
      })
    : ['No Data'];

  const textColor = isLight ? '#64748B' : '#94A3B8';
  const tooltipBg = isLight ? '#FFFFFF' : '#0F172A';
  const tooltipText = isLight ? '#0F172A' : '#F8FAFC';
  const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';

  _breakdownChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: hasData ? active.map(t => breakdown[t.key]) : [1],
        backgroundColor: hasData ? active.map(t => t.color) : ['#334155'],
        borderWidth: 0,
        spacing: 3,
        borderRadius: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '78%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: textColor,
            font: { family: 'Inter, sans-serif', size: 12, weight: '500' },
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 7,
            boxHeight: 7
          }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipText,
          bodyColor: tooltipText,
          borderColor: tooltipBorder,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleFont: { family: 'Outfit, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Inter, sans-serif', size: 12 },
          callbacks: {
            label: ctx => {
              const val = ctx.raw || 0;
              const pct = totalVal > 0 ? Math.round((val / totalVal) * 100) : 0;
              return ` ${ctx.label.split(' (')[0]}: ₱${Number(val).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function reloadCharts() {
  if (_lastMonthlyData && _lastSummaryBreakdownData) {
    renderMonthlyChart(_lastMonthlyData);
    renderBreakdownChart(_lastSummaryBreakdownData);
  }
}

// Redraw charts dynamically when the user switches themes
window.addEventListener('themechanged', () => {
  reloadCharts();
});

// Auto-refresh reports when transactions are modified anywhere
document.addEventListener('transaction-updated', () => {
  const container = document.getElementById('reports-content');
  if (container && container.offsetParent !== null) {
    initReports();
  }
});

async function downloadReport(type, eventId, eventName) {
  const token = window._authToken;
  if (!token) { alert('Please log in again.'); return; }

  const btn = document.querySelector(`[data-${type}="${eventId}"]`);
  const originalHTML = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = 'Generating…'; }

  try {
    const BASE = window.API_BASE || '';
    const res = await fetch(`${BASE}/api/reports/${type}/${eventId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `LGU-Report-${eventName.replace(/\s+/g, '-')}.${type === 'pdf' ? 'pdf' : 'xlsx'}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Download failed: ${err.message}`);
  } finally {
    if (btn && originalHTML) { btn.disabled = false; btn.innerHTML = originalHTML; }
}
}

// Export global namespace for app.js navigation
window.Reports = { load: initReports, reloadCharts };
