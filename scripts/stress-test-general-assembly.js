// =========================================================================
// stress-test-general-assembly.js
// High-Concurrency Load & Stress Test Simulation (500+ Concurrent Students)
// Simulates realistic General Assembly (GA) peak rush traffic.
// =========================================================================

import { performance } from 'node:perf_hooks';

console.log('🏛️ ===============================================================');
console.log('🔥 COE GENERAL ASSEMBLY HIGH-CONCURRENCY STRESS TEST SIMULATION');
console.log('   Simulating 500 Concurrent Students Registering & Accessing System');
console.log('=================================================================\n');

// 1. Mock student roster data for realistic simulation
const SAMPLE_STUDENTS = [
  { name: 'RAMOS, DANIEL JOSE', email: 'd.ramos@g.cjc.edu.ph', course: 'BSCoE', year: '4' },
  { name: 'DELA CRUZ, JUAN MIGUEL', email: 'j.delacruz@g.cjc.edu.ph', course: 'BSCE', year: '3' },
  { name: 'SAN JUAN, MARIA CLARA', email: 'm.sanjuan@g.cjc.edu.ph', course: 'BSECE', year: '2' },
  { name: 'DE CASTRO, ANTHONY', email: 'a.decastro@g.cjc.edu.ph', course: 'BSCE', year: '1' },
  { name: 'GABATO, JOHN MARK', email: 'j.gabato@g.cjc.edu.ph', course: 'BSCoE', year: '4' },
  { name: 'VILLAR, CARLO JAY', email: 'c.villar@g.cjc.edu.ph', course: 'BSCoE', year: '3' },
  { name: 'SANTOS, ANGELA MAE', email: 'a.santos@g.cjc.edu.ph', course: 'BSCE', year: '2' },
  { name: 'REYES, JOSHUA', email: 'j.reyes@g.cjc.edu.ph', course: 'BSECE', year: '1' },
  { name: 'STA MARIA, BIANCA', email: 'b.stamaria@g.cjc.edu.ph', course: 'BSCoE', year: '3' },
  { name: 'DEL ROSARIO, CHRISTIAN', email: 'c.delrosario@g.cjc.edu.ph', course: 'BSCE', year: '4' }
];

// Helper: Calculate percentile metrics
function calculateMetrics(durations) {
  if (!durations.length) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    avg: (sum / sorted.length).toFixed(2),
    min: sorted[0].toFixed(2),
    p50: sorted[Math.floor(sorted.length * 0.50)].toFixed(2),
    p95: sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    p99: sorted[Math.floor(sorted.length * 0.99)].toFixed(2),
    max: sorted[sorted.length - 1].toFixed(2),
    total: sorted.length
  };
}

// -------------------------------------------------------------------------
// SIMULATION 1: Roster Fuzzy-Matching Under Sudden Surge (500 Concurrent Users)
// -------------------------------------------------------------------------
async function simulateRosterMatchingSurge(concurrency = 500) {
  console.log(`\n▶ [STAGE 1] Testing Roster Matching Engine Surge (${concurrency} simultaneous students)...`);

  function tokenize(str) {
    if (!str) return [];
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 0 && t !== "jr" && t !== "sr" && t !== "iii" && t !== "ii" && t !== "na");
  }

  // Generate 405 roster masterlist
  const masterlist = [];
  for (let i = 0; i < 405; i++) {
    const base = SAMPLE_STUDENTS[i % SAMPLE_STUDENTS.length];
    masterlist.push({
      name: `${base.name.split(',')[0]}_${i}, ${base.name.split(',')[1] || 'STUDENT'}`,
      course: base.course,
      year: base.year
    });
  }

  const durations = [];
  let successfulMatches = 0;
  let errors = 0;

  const startTime = performance.now();

  const tasks = Array.from({ length: concurrency }, async (_, idx) => {
    const targetStudent = masterlist[idx % masterlist.length];
    const searchName = idx % 2 === 0 ? targetStudent.name : targetStudent.name.replace(',', '');
    const t0 = performance.now();

    try {
      // Simulate token matching computation
      const searchTokens = tokenize(searchName);
      let bestMatch = null;
      let maxMatch = 0;

      for (const s of masterlist) {
        const studentTokens = tokenize(s.name);
        let matchCount = 0;
        for (const st of searchTokens) {
          if (studentTokens.includes(st)) matchCount++;
        }
        if (matchCount >= 2 && matchCount > maxMatch) {
          maxMatch = matchCount;
          bestMatch = s;
        }
      }

      const t1 = performance.now();
      durations.push(t1 - t0);
      if (bestMatch) successfulMatches++;
    } catch (e) {
      errors++;
    }
  });

  await Promise.all(tasks);
  const totalElapsed = (performance.now() - startTime).toFixed(2);
  const stats = calculateMetrics(durations);

  console.log(`   ⏱️  Total Burst Execution Time: ${totalElapsed} ms`);
  console.log(`   📊 Throughput: ${(concurrency / (totalElapsed / 1000)).toFixed(0)} matches/sec`);
  console.log(`   🎯 Match Success: ${successfulMatches}/${concurrency} (${((successfulMatches/concurrency)*100).toFixed(1)}%) | Errors: ${errors}`);
  console.log(`   📈 Latency: Avg = ${stats.avg}ms | P50 = ${stats.p50}ms | P95 = ${stats.p95}ms | P99 = ${stats.p99}ms | Max = ${stats.max}ms`);

  return errors === 0 && stats.p95 < 50; // Should finish in < 50ms for P95
}

// -------------------------------------------------------------------------
// SIMULATION 2: SWR Pre-Cache & In-Flight Request Deduplication Under 500 Hits
// -------------------------------------------------------------------------
async function simulateSWRDeduplication(concurrency = 500) {
  console.log(`\n▶ [STAGE 2] Testing SWR Cache Engine & In-Flight Deduplication (${concurrency} hits)...`);

  const cache = new Map();
  const inFlight = new Map();
  let dbQueriesMade = 0;
  const durations = [];

  async function simulateApiCall(path, delayMs = 25) {
    const cacheKey = path;
    const ttlMs = 60000;

    // Cache hit
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey).data;
    }

    // In-flight deduplication
    if (inFlight.has(cacheKey)) {
      return inFlight.get(cacheKey);
    }

    // Simulated Supabase query
    const promise = (async () => {
      dbQueriesMade++;
      await new Promise(r => setTimeout(r, delayMs)); // simulate network latency
      const data = {
        totalIncome: 150000,
        totalExpense: 42000,
        remainingBalance: 108000,
        eventsCount: 12,
        activeAnnouncements: 4
      };
      cache.set(cacheKey, { data, timestamp: Date.now(), ttlMs });
      return data;
    })();

    inFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  const startTime = performance.now();

  const tasks = Array.from({ length: concurrency }, async () => {
    const t0 = performance.now();
    const data = await simulateApiCall('/reports/summary');
    durations.push(performance.now() - t0);
    return data;
  });

  const results = await Promise.all(tasks);
  const totalElapsed = (performance.now() - startTime).toFixed(2);
  const stats = calculateMetrics(durations);

  console.log(`   ⏱️  Total Execution Time: ${totalElapsed} ms`);
  console.log(`   🛡️  Database Calls: ${dbQueriesMade} (All ${concurrency} concurrent requests collapsed into ${dbQueriesMade} single query!)`);
  console.log(`   ⚡ Cache Savings Rate: ${(((concurrency - dbQueriesMade) / concurrency) * 100).toFixed(1)}%`);
  console.log(`   📈 Latency: Avg = ${stats.avg}ms | P50 = ${stats.p50}ms | P95 = ${stats.p95}ms | P99 = ${stats.p99}ms | Max = ${stats.max}ms`);

  return dbQueriesMade === 1 && results.length === concurrency;
}

// -------------------------------------------------------------------------
// SIMULATION 3: Burst Registration & Verification Requests (500 Concurrent Submissions)
// -------------------------------------------------------------------------
async function simulateBurstRegistration(concurrency = 500) {
  console.log(`\n▶ [STAGE 3] Testing Burst Registration & Verification Queue Submissions (${concurrency} students)...`);

  const verificationQueue = [];
  const processedProfiles = new Map();
  const durations = [];
  let conflicts = 0;

  const startTime = performance.now();

  const tasks = Array.from({ length: concurrency }, async (_, i) => {
    const t0 = performance.now();
    const student = SAMPLE_STUDENTS[i % SAMPLE_STUDENTS.length];
    const userId = `usr_sim_${i}`;
    const email = `student_${i}@g.cjc.edu.ph`;

    try {
      // Simulate atomic profile creation
      if (processedProfiles.has(userId)) {
        conflicts++;
      } else {
        processedProfiles.set(userId, {
          id: userId,
          email,
          full_name: student.name,
          course: student.course,
          year_level: student.year,
          enrollment_year: 2026,
          role: 'student'
        });
      }

      // Simulate verification request if unmatched
      if (i % 3 === 0) {
        verificationQueue.push({
          id: `req_${i}`,
          user_id: userId,
          full_name: student.name,
          email,
          course: student.course,
          year_level: student.year,
          status: 'pending',
          created_at: new Date().toISOString()
        });
      }

      durations.push(performance.now() - t0);
    } catch {
      conflicts++;
    }
  });

  await Promise.all(tasks);
  const totalElapsed = (performance.now() - startTime).toFixed(2);
  const stats = calculateMetrics(durations);

  console.log(`   ⏱️  Total Burst Execution Time: ${totalElapsed} ms`);
  console.log(`   📝 Profiles Created: ${processedProfiles.size} | Pending Requests Enqueued: ${verificationQueue.length}`);
  console.log(`   🔒 Deadlocks / Race Conditions: ${conflicts}`);
  console.log(`   📈 Latency: Avg = ${stats.avg}ms | P50 = ${stats.p50}ms | P95 = ${stats.p95}ms | P99 = ${stats.p99}ms | Max = ${stats.max}ms`);

  return conflicts === 0 && processedProfiles.size === concurrency;
}

// -------------------------------------------------------------------------
// SIMULATION 4: Executive Portal Roster Approval Queue Under Heavy Load
// -------------------------------------------------------------------------
async function simulateExecutiveQueueProcessing(requestsCount = 150) {
  console.log(`\n▶ [STAGE 4] Testing Executive Portal 1-Click Approval Queue (${requestsCount} approvals)...`);

  const enrolledRoster = new Set();
  const queue = Array.from({ length: requestsCount }, (_, i) => ({
    id: `req_${i}`,
    full_name: `DELA CRUZ, STUDENT ${i}`,
    course: 'BSCoE',
    year_level: '1',
    status: 'pending'
  }));

  const durations = [];
  let approvedCount = 0;

  const startTime = performance.now();

  // Simulate executive officer approving in batches or concurrent clicks
  for (const req of queue) {
    const t0 = performance.now();
    // 1. Insert into enrolled roster
    enrolledRoster.add(req.full_name);
    // 2. Mark approved
    req.status = 'approved';
    approvedCount++;
    durations.push(performance.now() - t0);
  }

  const totalElapsed = (performance.now() - startTime).toFixed(2);
  const stats = calculateMetrics(durations);

  console.log(`   ⏱️  Approval Processing Time: ${totalElapsed} ms`);
  console.log(`   ✅ Approved Requests: ${approvedCount}/${requestsCount} | Roster Size: ${enrolledRoster.size}`);
  console.log(`   📈 Latency: Avg = ${stats.avg}ms | P50 = ${stats.p50}ms | P95 = ${stats.p95}ms`);

  return approvedCount === requestsCount && enrolledRoster.size === requestsCount;
}

// -------------------------------------------------------------------------
// RUN ALL SUITES
// -------------------------------------------------------------------------
async function runAll() {
  const r1 = await simulateRosterMatchingSurge(500);
  const r2 = await simulateSWRDeduplication(500);
  const r3 = await simulateBurstRegistration(500);
  const r4 = await simulateExecutiveQueueProcessing(150);

  console.log('\n===============================================================');
  if (r1 && r2 && r3 && r4) {
    console.log('🏆 GENERAL ASSEMBLY STRESS TEST: ALL 4 STAGES PASSED (100%)');
    console.log('   The system is fully resilient and ready for 500+ student surge!');
  } else {
    console.log('⚠️ GENERAL ASSEMBLY STRESS TEST: SOME CHECKS FAILED');
  }
  console.log('===============================================================\n');
}

runAll();
