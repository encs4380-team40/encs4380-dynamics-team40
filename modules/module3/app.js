
  'use strict';

  const THEME = {
    font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    text: '#475569',
    grid: '#e6ebf1',
    axis: '#cbd5e1',
    output: '#0f766e',
    ideal: '#1e293b',
    reference: '#94a3b8',
    tau: '#2563eb',
    tau3: '#0f172a',
    error: '#d97706',
    errorText: '#b45309'
  };
  const CHARTS_AVAILABLE = typeof window.Chart === 'function';
  function fmt(value, decimals = 3) {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.abs(value) < 0.5 * Math.pow(10, -decimals) ? 0 : value;
    const text = rounded.toFixed(decimals);
    return text.charAt(0) === '-' ? '\u2212' + text.slice(1) : text;
  }
  function fmtTick(value) {
    return String(Number(value.toFixed(2)));
  }
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, (ch) => map[ch]);
  }
  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  function applyChartDefaults() {
    Chart.defaults.font.family = THEME.font;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = THEME.text;
    Chart.defaults.borderColor = THEME.grid;
  }
  function tooltipStyle() {
    return {
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      footerColor: '#5eead4',
      titleFont: { weight: '600' },
      footerFont: { weight: '500' },
      padding: 10,
      cornerRadius: 8,
      boxPadding: 4,
      caretSize: 5
    };
  }
  function createGuidesPlugin(getGuides) {
    return {
      id: 'teachingGuides',
      beforeDatasetsDraw(chart) {
        const guides = getGuides();
        if (guides) drawClipped(chart, () => (guides.lines || []).forEach((s) => drawSegment(chart, s)));
      },
      afterDatasetsDraw(chart) {
        const guides = getGuides();
        if (!guides) return;
        drawClipped(chart, () => {
          (guides.segments || []).forEach((s) => drawSegment(chart, s));
          (guides.markers || []).forEach((m) => drawMarker(chart, m));
        });
        (guides.labels || []).forEach((label) => drawLabel(chart, label));
      }
    };
  }
  function drawClipped(chart, drawFn) {
    const { ctx, chartArea: a } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top);
    ctx.clip();
    drawFn();
    ctx.restore();
  }
  function toPixels(chart, x, y, yAxis) {
    return { px: chart.scales.x.getPixelForValue(x), py: chart.scales[yAxis || 'y'].getPixelForValue(y) };
  }
  function drawSegment(chart, s) {
    const a = toPixels(chart, s.x1, s.y1, s.yAxis);
    const b = toPixels(chart, s.x2, s.y2, s.yAxis);
    if (![a.px, a.py, b.px, b.py].every(Number.isFinite)) return;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1.25;
    ctx.setLineDash(s.dash || []);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    if (s.caps) {
      const len = Math.hypot(b.px - a.px, b.py - a.py) || 1;
      const nx = (-(b.py - a.py) / len) * 5;
      const ny = ((b.px - a.px) / len) * 5;
      [a, b].forEach((p) => { ctx.moveTo(p.px - nx, p.py - ny); ctx.lineTo(p.px + nx, p.py + ny); });
    }
    ctx.stroke();
    ctx.restore();
  }
  function drawMarker(chart, m) {
    const p = toPixels(chart, m.x, m.y, m.yAxis);
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) return;
    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.px, p.py, m.radius || 5.5, 0, Math.PI * 2);
    ctx.fillStyle = m.color;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawLabel(chart, label) {
    const p = toPixels(chart, label.x, label.y, label.yAxis);
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) return;
    const { ctx, chartArea: area } = chart;
    const narrow = area.right - area.left < 440;
    const text = narrow && label.short ? label.short : label.text;
    ctx.save();
    ctx.font = `600 11.5px ${THEME.font}`;
    const w = ctx.measureText(text).width + 12;
    const h = 20;
    const ax = p.px + (label.dx || 0);
    const ay = p.py + (label.dy || 0);
    let left = label.align === 'right' ? ax - w : label.align === 'center' ? ax - w / 2 : ax;
    let top = ay - h / 2;
    left = Math.min(Math.max(left, area.left + 2), area.right - w - 2);
    top = Math.min(Math.max(top, area.top + 2), area.bottom - h - 2);
    roundedRectPath(ctx, left, top, w, h, 6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fill();
    ctx.strokeStyle = hexToRgba(label.color, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = label.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 6, top + h / 2 + 0.5);
    ctx.restore();
  }
  const LEGEND_SWATCHES = {
    line:   (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2.75" stroke-linecap="round"/>`,
    dashed: (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2" stroke-dasharray="6 4"/>`,
    dotted: (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2" stroke-dasharray="2 3"/>`,
    dot:    (c) => `<circle cx="12" cy="6" r="4.5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`,
    vbar:   (c) => `<path d="M12 1.5v9M9 1.5h6M9 10.5h6" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    hbar:   (c) => `<path d="M3 6h18M3 3v6M21 3v6" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  };
  function renderLegend(listEl, items) {
    listEl.innerHTML = items.map((item) =>
      `<li><svg class="legend-swatch" viewBox="0 0 24 12" width="24" height="12" aria-hidden="true">${LEGEND_SWATCHES[item.kind](item.color)}</svg>${escapeHtml(item.label)}</li>`
    ).join('');
  }
  function renderValidation(tbody, checks) {
    tbody.replaceChildren(...checks.map((check) => {
      const row = document.createElement('tr');
      row.append(
        validationCell('Check', check.name, check.detail),
        validationCell('Expected', check.expected.main, check.expected.sub),
        validationCell('Calculated', check.calculated.main, check.calculated.sub),
        statusCell(check.pass)
      );
      return row;
    }));
    return checks.filter((check) => check.pass).length;
  }
  function validationCell(label, main, sub) {
    const td = document.createElement('td');
    td.dataset.label = label;
    const wrap = document.createElement('div');
    const mainEl = document.createElement('span');
    mainEl.className = 'cell-main';
    mainEl.textContent = main;
    wrap.append(mainEl);
    if (sub) {
      const subEl = document.createElement('span');
      subEl.className = 'cell-sub';
      subEl.textContent = sub;
      wrap.append(subEl);
    }
    td.append(wrap);
    return td;
  }
  function statusCell(pass) {
    const td = document.createElement('td');
    td.dataset.label = 'Status';
    const badge = document.createElement('span');
    badge.className = 'status ' + (pass ? 'status--pass' : 'status--fail');
    badge.textContent = pass ? 'PASS' : 'FAIL';
    const wrap = document.createElement('div');
    wrap.append(badge);
    td.append(wrap);
    return td;
  }
  function createPredictCheck(root, questions, hooks = {}) {
    const part = (role) => root.querySelector(`[data-role="${role}"]`);
    const prompt = part('prompt');
    const choicesBox = part('choices');
    const checkBtn = part('check');
    const retryBtn = part('retry');
    const nextBtn = part('next');
    const hint = part('hint');
    const feedback = part('feedback');
    const progress = part('progress');
    const steps = root.querySelectorAll('[data-step]');
    const groupName = root.id + '-choice';
    let current = 0;
    let checked = false;
    let observed = false;
    function setStage(stage) {
      const order = ['predict', 'check', 'observe'];
      const activeIndex = stage === 'predict' ? 0 : stage === 'observe' ? 2 : 3;
      steps.forEach((li) => {
        const i = order.indexOf(li.dataset.step);
        li.classList.toggle('is-done', i < activeIndex);
        li.classList.toggle('is-active', i === activeIndex);
      });
    }
    function renderQuestion() {
      const q = questions[current];
      checked = false;
      observed = false;
      prompt.textContent = q.prompt;
      progress.textContent = `Question ${current + 1} of ${questions.length}`;
      choicesBox.replaceChildren(...q.choices.map((choice, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.id = `${groupName}-${current}-${i}`;
        input.value = String(i);
        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = choice.text;
        wrap.append(input, label);
        return wrap;
      }));
      checkBtn.hidden = false;
      checkBtn.disabled = true;
      hint.hidden = false;
      retryBtn.hidden = true;
      nextBtn.hidden = true;
      feedback.hidden = true;
      feedback.replaceChildren();
      setStage('predict');
    }
    function addParagraph(text, className) {
      const p = document.createElement('p');
      if (className) p.className = className;
      p.textContent = text;
      feedback.append(p);
      return p;
    }
    choicesBox.addEventListener('change', () => {
      if (!checked) { checkBtn.disabled = false; hint.hidden = true; }
    });
    checkBtn.addEventListener('click', () => {
      const selected = choicesBox.querySelector('input:checked');
      if (!selected) return;
      const q = questions[current];
      const picked = Number(selected.value);
      const isCorrect = q.choices[picked].correct;
      const correctChoice = q.choices.find((c) => c.correct);
      checked = true;
      choicesBox.querySelectorAll('.choice').forEach((wrap, i) => {
        wrap.querySelector('input').disabled = true;
        const tag = document.createElement('span');
        tag.className = 'choice-tag';
        if (q.choices[i].correct) {
          wrap.classList.add('is-correct');
          tag.textContent = i === picked ? 'Your answer: correct' : 'Correct answer';
          wrap.querySelector('label').append(tag);
        } else if (i === picked) {
          wrap.classList.add('is-wrong');
          tag.textContent = 'Your answer';
          wrap.querySelector('label').append(tag);
        }
      });
      feedback.className = 'feedback ' + (isCorrect ? 'is-correct' : 'is-wrong');
      feedback.replaceChildren();
      addParagraph(isCorrect ? `Correct: ${correctChoice.text}` : `Not quite. The answer is: ${correctChoice.text}`, 'feedback-title');
      addParagraph(q.explanation);
      addParagraph(q.tryIt);
      feedback.hidden = false;
      checkBtn.hidden = true;
      retryBtn.hidden = false;
      nextBtn.hidden = false;
      nextBtn.textContent = current === questions.length - 1 ? 'Back to question 1' : 'Next question';
      setStage('observe');
      if (hooks.onCheck) hooks.onCheck(q, isCorrect);
      feedback.focus({ preventScroll: true });
    });
    retryBtn.addEventListener('click', () => {
      renderQuestion();
      const first = choicesBox.querySelector('input');
      if (first) first.focus();
    });
    nextBtn.addEventListener('click', () => {
      current = (current + 1) % questions.length;
      renderQuestion();
      prompt.scrollIntoView({ block: 'nearest' });
    });
    renderQuestion();
    return {
      notifyInteraction() {
        if (!checked || observed) return;
        observed = true;
        setStage('done');
        addParagraph('Observed: compare the live curve with the dotted reference curve.', 'feedback-observed');
      }
    };
  }
  

  const SecondOrder = {
    classify(zeta) {
      if (Math.abs(zeta - 1) < 1e-9) return 'critical';
      return zeta < 1 ? 'under' : 'over';
    },

    poles(zeta, wn) {
      const kind = this.classify(zeta);
      if (kind === 'under') {
        const d = wn * Math.sqrt(1 - zeta * zeta);
        return [{ re: -zeta * wn, im: d }, { re: -zeta * wn, im: -d }];
      }
      if (kind === 'critical') return [{ re: -wn, im: 0 }, { re: -wn, im: 0 }];
      const r = wn * Math.sqrt(zeta * zeta - 1);
      return [{ re: -zeta * wn + r, im: 0 }, { re: -zeta * wn - r, im: 0 }];
    },

    // eigenvalues of A = [[0, 1], [-k/m, -b/m]] from its trace and determinant
    eigenvalues(m, b, k) {
      const tr = -b / m;
      const det = k / m;
      const disc = tr * tr / 4 - det;
      if (disc < 0) {
        const d = Math.sqrt(-disc);
        return [{ re: tr / 2, im: d }, { re: tr / 2, im: -d }];
      }
      const r = Math.sqrt(disc);
      return [{ re: tr / 2 + r, im: 0 }, { re: tr / 2 - r, im: 0 }];
    },

    // unit step response (K = 1)
    step(t, zeta, wn) {
      if (t <= 0) return 0;
      const kind = this.classify(zeta);
      if (kind === 'under') {
        const s = zeta * wn;
        const d = wn * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-s * t) * (Math.cos(d * t) + (s / d) * Math.sin(d * t));
      }
      if (kind === 'critical') return 1 - (1 + wn * t) * Math.exp(-wn * t);
      const [p1, p2] = this.poles(zeta, wn).map((p) => p.re);
      return 1 - (p2 * Math.exp(p1 * t) - p1 * Math.exp(p2 * t)) / (p2 - p1);
    },

    overshootFormula(zeta) {
      return zeta < 1 - 1e-9 ? Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)) : 0;
    },

    peakTimeFormula(zeta, wn) {
      return Math.PI / (wn * Math.sqrt(1 - zeta * zeta));
    }
  };

  // Reads rise time, peak, overshoot and settling time off a finely sampled step curve.
  function measure(zeta, wn) {
    const slow = Math.min(...SecondOrder.poles(zeta, wn).map((p) => Math.abs(p.re)));
    const N = 20000;
    const dt = (10 / slow) / N;
    let t10 = NaN, t90 = NaN, ymax = 0, tPeak = 0, tSettle = 0, prev = 0;
    for (let i = 1; i <= N; i++) {
      const t = i * dt;
      const y = SecondOrder.step(t, zeta, wn);
      if (Number.isNaN(t10) && y >= 0.1) t10 = t - dt + dt * (0.1 - prev) / (y - prev);
      if (Number.isNaN(t90) && y >= 0.9) t90 = t - dt + dt * (0.9 - prev) / (y - prev);
      if (y > ymax) { ymax = y; tPeak = t; }
      if (Math.abs(y - 1) > 0.02) tSettle = t;
      prev = y;
    }
    const overshoots = ymax > 1 + 1e-9;
    return {
      t10, t90, tr: t90 - t10,
      ymax, mp: overshoots ? (ymax - 1) * 100 : 0,
      tp: overshoots ? tPeak : NaN,
      ts: tSettle
    };
  }

  function niceCeil(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / p;
    const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => s >= m - 1e-9);
    return step * p;
  }

  // RK4 on x' = A x + B F, returns every sample as { t, x1, x2 }
  function simulateStateSpace(m, b, k, F, T, steps) {
    const f = (x1, x2) => [x2, (F - k * x1 - b * x2) / m];
    const dt = T / steps;
    const out = [{ t: 0, x1: 0, x2: 0 }];
    let x1 = 0, x2 = 0;
    for (let i = 1; i <= steps; i++) {
      const [a1, a2] = f(x1, x2);
      const [b1, b2] = f(x1 + dt / 2 * a1, x2 + dt / 2 * a2);
      const [c1, c2] = f(x1 + dt / 2 * b1, x2 + dt / 2 * b2);
      const [d1, d2] = f(x1 + dt * c1, x2 + dt * c2);
      x1 += dt / 6 * (a1 + 2 * b1 + 2 * c1 + d1);
      x2 += dt / 6 * (a2 + 2 * b2 + 2 * c2 + d2);
      out.push({ t: i * dt, x1, x2 });
    }
    return out;
  }

  function sortPoles(list) {
    return [...list].sort((p, q) => (q.re - p.re) || (q.im - p.im));
  }

  function poleGap(a, b) {
    const sa = sortPoles(a), sb = sortPoles(b);
    return Math.max(...sa.map((p, i) => Math.hypot(p.re - sb[i].re, p.im - sb[i].im)));
  }

  function fmtComplex(c, decimals = 3) {
    if (Math.abs(c.im) < 5e-7) return fmt(c.re, decimals);
    return `${fmt(c.re, decimals)} ${c.im < 0 ? '\u2212' : '+'} j${fmt(Math.abs(c.im), decimals)}`;
  }

  function initModule3() {
    const DEFAULTS = Object.freeze({ mode: 'zw', zeta: 0.5, wn: 2, K: 1, m: 1, b: 2, k: 4 });
    const LIMITS = {
      zeta: [0.05, 2.5, 0.05], wn: [0.5, 10, 0.1], K: [0.5, 3, 0.1],
      m: [0.5, 5, 0.1], b: [0.5, 20, 0.1], k: [1, 50, 0.5]
    };
    const state = Object.assign({}, DEFAULTS, { reference: null });

    const $ = (id) => document.getElementById(id);
    const ui = {
      modeRadios: document.querySelectorAll('input[name="m3-mode"]'), modeHelp: $('m3-mode-help'),
      setZW: $('m3-set-zw'), setMBK: $('m3-set-mbk'),
      sliders: {
        zeta: $('m3-zeta'), wn: $('m3-wn'), K: $('m3-k'), m: $('m3-m'), b: $('m3-b'), k: $('m3-spring')
      },
      outputs: {
        zeta: $('m3-zeta-value'), wn: $('m3-wn-value'), K: $('m3-k-value'),
        m: $('m3-m-value'), b: $('m3-b-value'), k: $('m3-spring-value')
      },
      derived: $('m3-derived'), reset: $('m3-reset'), pin: $('m3-pin'), unpin: $('m3-unpin'),
      refStatus: $('m3-ref-status'), caseChip: $('m3-case-chip'),
      mainLegend: $('m3-main-legend'), mainCanvas: $('m3-main-chart'),
      sLegend: $('m3-s-legend'), sCanvas: $('m3-s-chart'), sChip: $('m3-s-chip'),
      pLegend: $('m3-p-legend'), pCanvas: $('m3-p-chart'), pChip: $('m3-p-chip'), pNote: $('m3-p-note'),
      ssLive: $('m3-ss-live'), ssNote: $('m3-ss-note'), ssChip: $('m3-ss-chip'),
      eigList: $('m3-eig-list'), poleList: $('m3-pole-list'), pzChip: $('m3-pz-chip'),
      charPoly: $('m3-charpoly'), rk4Gap: $('m3-rk4-gap'),
      caseTitle: $('m3-case-title'), caseText: $('m3-case-text'),
      validationBody: $('m3-validation-body'), validationSummary: $('m3-validation-summary')
    };

    let mainChart = null, sChart = null, pChart = null;
    let mainGuides = null, sGuides = null, pGuides = null;

    const QUESTIONS = [
      {
        prompt: 'With ω\u2099 fixed, ζ is raised from 0.3 to 0.8. What happens to the overshoot?',
        choices: [
          { text: 'It grows, because there is more damping to push against.', correct: false },
          { text: 'It shrinks a lot, from about 37% to about 1.5%.', correct: true },
          { text: 'It stays the same, because only ω\u2099 sets the overshoot.', correct: false }
        ],
        explanation: 'Overshoot is M\u209a = e^(\u2212\u03c0\u03b6/\u221a(1\u2212\u03b6\u00b2)). At \u03b6 = 0.3 that is 37.2%, at \u03b6 = 0.8 only 1.5%. More damping drains the oscillation sooner, so the output has less energy left to carry it past the final value.',
        tryIt: 'Your current curve is pinned as the dotted reference. In the \u03b6 and \u03c9\u2099 controls, drag \u03b6 up toward 0.8 and watch the overshoot card fall.'
      },
      {
        prompt: 'You double ω\u2099 and keep ζ = 0.5. Which statement is true?',
        choices: [
          { text: 'Overshoot doubles and the peak comes at the same time.', correct: false },
          { text: 'Overshoot stays at 16.3%, but the peak comes in half the time.', correct: true },
          { text: 'Overshoot halves and the peak comes at the same time.', correct: false }
        ],
        explanation: 'Doubling \u03c9\u2099 only speeds the clock up: t\u209a = \u03c0 / (\u03c9\u2099\u221a(1\u2212\u03b6\u00b2)) is halved. The shape of the curve, and with it the overshoot percentage, is a function of \u03b6 alone.',
        tryIt: 'Pin the curve, then move \u03c9\u2099 from 2 to 4. The live curve is the reference squeezed in time, with the same height at its peak.'
      },
      {
        prompt: 'ζ increases from 0.2 to 0.9 with ω\u2099 fixed. Where do the poles go in the s-plane?',
        choices: [
          { text: 'They slide along the circle of radius \u03c9\u2099, toward the negative real axis.', correct: true },
          { text: 'They move straight up, away from the real axis.', correct: false },
          { text: 'They stay where they are. Only the curve changes.', correct: false }
        ],
        explanation: 'For \u03b6 < 1 the poles are \u2212\u03b6\u03c9\u2099 \u00b1 j\u03c9\u2099\u221a(1\u2212\u03b6\u00b2), whose distance from the origin is always \u03c9\u2099. Only the angle changes: cos \u03b8 = \u03b6, so a larger \u03b6 tips them down toward the real axis, where they meet at \u03b6 = 1.',
        tryIt: 'Pin the curve and drag \u03b6 up. The pinned poles stay as grey crosses in the s-plane, so you can see where the live poles moved from.'
      }
    ];

    /* ---------- state and derived values ---------- */

    function derive(s) {
      if (s.mode === 'zw') {
        const k = s.wn * s.wn;
        return { zeta: s.zeta, wn: s.wn, K: s.K, m: 1, b: 2 * s.zeta * s.wn, k, F: s.K * k };
      }
      return {
        zeta: s.b / (2 * Math.sqrt(s.k * s.m)), wn: Math.sqrt(s.k / s.m), K: 1 / s.k,
        m: s.m, b: s.b, k: s.k, F: 1
      };
    }

    function snap(key, value) {
      const [min, max, step] = LIMITS[key];
      const clamped = Math.min(max, Math.max(min, value));
      return Number((Math.round((clamped - min) / step) * step + min).toFixed(4));
    }

    function switchMode(next) {
      if (next === state.mode) return;
      const d = derive(state);
      if (next === 'mbk') {
        state.m = snap('m', d.m); state.b = snap('b', d.b); state.k = snap('k', d.k);
      } else {
        state.zeta = snap('zeta', d.zeta); state.wn = snap('wn', d.wn); state.K = snap('K', d.K);
      }
      state.mode = next;
    }

    function visibleReference(d) {
      const r = state.reference;
      if (!r) return null;
      const same = ['zeta', 'wn', 'K'].every((key) => Math.abs(r[key] - d[key]) < 1e-9);
      return same ? null : r;
    }

    function refText(r) {
      return `\u03b6 = ${r.zeta.toFixed(2)}, \u03c9n = ${r.wn.toFixed(1)} rad/s, K = ${r.K.toFixed(2)}`;
    }

    const CASE_NAME = { under: 'Underdamped', critical: 'Critically damped', over: 'Overdamped' };

    /* ---------- charts ---------- */

    function timeTitle(items) {
      return items.length ? `t = ${fmt(items[0].parsed.x, 2)} s` : '';
    }

    function createCharts() {
      if (!CHARTS_AVAILABLE) {
        document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = false; });
        return;
      }
      applyChartDefaults();
      const base = () => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        normalized: true,
        elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 6, hoverBorderWidth: 2 } },
        layout: { padding: { top: 6, right: 10 } }
      });
      const axisTitle = (text) => ({ display: true, text, font: { weight: '600' } });

      mainChart = new Chart(ui.mainCanvas, {
        type: 'line',
        data: {
          datasets: [
            { role: 'ideal', label: 'Final value K', data: [], borderColor: THEME.ideal, backgroundColor: THEME.ideal,
              borderWidth: 1.5, borderDash: [6, 5], order: 1, pointHoverBackgroundColor: '#fff' },
            { role: 'output', label: 'Sensor output y(t)', data: [], borderColor: THEME.output, backgroundColor: THEME.output,
              borderWidth: 2.75, order: 0, pointHoverBackgroundColor: '#fff' },
            { role: 'reference', label: 'Reference', data: [], borderColor: THEME.reference, backgroundColor: THEME.reference,
              borderWidth: 2, borderDash: [2, 3], order: 2, hidden: true, pointHoverBackgroundColor: '#fff' }
          ]
        },
        options: Object.assign(base(), {
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { type: 'linear', min: 0, title: axisTitle('Time t (s)'), grid: { color: THEME.grid }, border: { color: THEME.axis } },
            y: { beginAtZero: true, grace: '8%', title: axisTitle('Output y(t)'), grid: { color: THEME.grid }, border: { color: THEME.axis } }
          },
          plugins: {
            legend: { display: false },
            tooltip: Object.assign(tooltipStyle(), {
              itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
              callbacks: {
                title: timeTitle,
                label: (item) => item.dataset.role === 'output'
                  ? ` Sensor output y(t): ${fmt(item.parsed.y, 3)}  (${fmt(100 * item.parsed.y / currentK, 1)}% of final)`
                  : ` ${item.dataset.label}: ${fmt(item.parsed.y, 3)}`
              }
            })
          }
        }),
        plugins: [createGuidesPlugin(() => mainGuides)]
      });

      sChart = new Chart(ui.sCanvas, {
        type: 'scatter',
        data: {
          datasets: [
            { role: 'circle', label: '|s| = \u03c9n', data: [], showLine: true, borderColor: THEME.reference, borderWidth: 1.5,
              borderDash: [5, 4], pointRadius: 0, hoverRadius: 0, order: 3 },
            { role: 'refpoles', label: 'Pinned poles', data: [], showLine: false, pointStyle: 'crossRot', pointRadius: 7,
              borderColor: THEME.reference, borderWidth: 2.5, order: 2, hidden: true },
            { role: 'poles', label: 'Poles', data: [], showLine: false, pointStyle: 'crossRot', pointRadius: 9, hoverRadius: 10,
              borderColor: THEME.output, borderWidth: 3.5, order: 0 }
          ]
        },
        options: Object.assign(base(), {
          normalized: false,
          interaction: { mode: 'nearest', intersect: true },
          scales: {
            x: { type: 'linear', title: axisTitle('Real part (1/s)'), grid: { color: THEME.grid }, border: { color: THEME.axis } },
            y: { type: 'linear', title: axisTitle('Imaginary part (rad/s)'), grid: { color: THEME.grid }, border: { color: THEME.axis } }
          },
          plugins: {
            legend: { display: false },
            tooltip: Object.assign(tooltipStyle(), {
              filter: (item) => item.dataset.role !== 'circle',
              callbacks: {
                title: () => '',
                label: (item) => ` ${item.dataset.label}: s = ${fmtComplex({ re: item.parsed.x, im: item.parsed.y }, 3)}`
              }
            })
          }
        }),
        plugins: [createGuidesPlugin(() => sGuides)]
      });

      pChart = new Chart(ui.pCanvas, {
        type: 'scatter',
        data: {
          datasets: [
            { role: 'path', label: 'Path', data: [], showLine: true, borderColor: THEME.output, borderWidth: 2.25,
              pointRadius: 0, hoverRadius: 4, order: 0 }
          ]
        },
        options: Object.assign(base(), {
          normalized: false,
          interaction: { mode: 'nearest', intersect: false },
          scales: {
            x: { type: 'linear', beginAtZero: true, grace: '8%', title: axisTitle('Position x\u2081 (m)'), grid: { color: THEME.grid }, border: { color: THEME.axis } },
            y: { type: 'linear', beginAtZero: true, grace: '8%', title: axisTitle('Velocity x\u2082 (m/s)'), grid: { color: THEME.grid }, border: { color: THEME.axis } }
          },
          plugins: {
            legend: { display: false },
            tooltip: Object.assign(tooltipStyle(), {
              callbacks: {
                title: (items) => items.length ? `t = ${fmt(items[0].raw.t, 2)} s` : '',
                label: (item) => ` x\u2081 = ${fmt(item.parsed.x, 3)},  x\u2082 = ${fmt(item.parsed.y, 3)}`
              }
            })
          }
        }),
        plugins: [createGuidesPlugin(() => pGuides)]
      });
    }

    let currentK = 1;
    const BIG = 1e6;

    function mainGuidesFor(d, met, span) {
      const K = d.K;
      const lines = [
        { x1: 0, y1: 1.02 * K, x2: span, y2: 1.02 * K, color: hexToRgba(THEME.tau3, 0.3), dash: [2, 4] },
        { x1: 0, y1: 0.98 * K, x2: span, y2: 0.98 * K, color: hexToRgba(THEME.tau3, 0.3), dash: [2, 4] },
        { x1: met.ts, y1: 0, x2: met.ts, y2: K, color: hexToRgba(THEME.tau3, 0.55), dash: [3, 4] },
        { x1: met.t10, y1: 0.03 * K, x2: met.t10, y2: 0.1 * K, color: hexToRgba(THEME.tau, 0.7), dash: [3, 3] },
        { x1: met.t90, y1: 0.03 * K, x2: met.t90, y2: 0.9 * K, color: hexToRgba(THEME.tau, 0.7), dash: [3, 3] }
      ];
      const segments = [{ x1: met.t10, y1: 0.03 * K, x2: met.t90, y2: 0.03 * K, color: THEME.tau, width: 2.5, caps: true }];
      const markers = [
        { x: met.t10, y: 0.1 * K, color: THEME.tau },
        { x: met.t90, y: 0.9 * K, color: THEME.tau },
        { x: met.ts, y: K * SecondOrder.step(met.ts, d.zeta, d.wn), color: THEME.tau3 }
      ];
      const labels = [
        { x: met.t90, y: 0.03 * K, dx: 10, dy: 0, text: `t\u1d63 = ${fmt(met.tr, 2)} s`, short: fmt(met.tr, 2) + ' s', color: THEME.tau },
        { x: met.ts, y: 0.3 * K, dx: 8, text: `t\u209b = ${fmt(met.ts, 2)} s`, short: fmt(met.ts, 1) + ' s', color: THEME.tau3 },
        { x: span, y: K, dx: -2, dy: -14, align: 'right', text: `Final value = ${fmt(K, 3)}`, short: fmt(K, 2), color: THEME.ideal }
      ];
      if (Number.isFinite(met.tp)) {
        const peak = K * met.ymax;
        lines.push({ x1: met.tp, y1: 0, x2: met.tp, y2: K, color: hexToRgba(THEME.error, 0.6), dash: [3, 4] });
        segments.push({ x1: met.tp, y1: K, x2: met.tp, y2: peak, color: THEME.error, width: 2.5, caps: true });
        markers.push({ x: met.tp, y: peak, color: THEME.error });
        labels.push({
          x: met.tp, y: peak, dx: 10, dy: -12,
          text: `Overshoot ${fmt(met.mp, 1)}% at t\u209a = ${fmt(met.tp, 2)} s`, short: `${fmt(met.mp, 1)}%`, color: THEME.errorText
        });
      } else {
        labels.push({ x: met.t90, y: 0.9 * K, dx: -10, dy: -16, align: 'right', text: 'No overshoot', short: 'No overshoot', color: THEME.errorText });
      }
      return { lines, segments, markers, labels };
    }

    function mainLegendItems(hasPeak, ref) {
      const items = [
        { label: 'Final value K', kind: 'dashed', color: THEME.ideal },
        { label: 'Sensor output y(t)', kind: 'line', color: THEME.output },
        { label: '10% and 90% points, rise time', kind: 'hbar', color: THEME.tau },
        { label: '\u00b12% band and settling time', kind: 'dot', color: THEME.tau3 }
      ];
      if (hasPeak) items.push({ label: 'Peak and overshoot', kind: 'vbar', color: THEME.error });
      if (ref) items.push({ label: `Reference (${refText(ref)})`, kind: 'dotted', color: THEME.reference });
      return items;
    }

    function poleLabel(p) {
      return Math.abs(p.im) < 5e-7 ? fmt(p.re, 2) : `${fmt(p.re, 2)} \u00b1 j${fmt(Math.abs(p.im), 2)}`;
    }

    function updatePoleChart(d, kind, ref) {
      const poles = SecondOrder.poles(d.zeta, d.wn);
      const refPoles = ref ? SecondOrder.poles(ref.zeta, ref.wn) : [];
      const reach = Math.max(d.wn, ref ? ref.wn : 0, ...[...poles, ...refPoles].map((p) => Math.hypot(p.re, p.im)));
      const R = 1.18 * reach;
      const circle = Array.from({ length: 121 }, (_, i) => {
        const a = (i / 120) * 2 * Math.PI;
        return { x: d.wn * Math.cos(a), y: d.wn * Math.sin(a) };
      });
      const ink = hexToRgba(THEME.ideal, 0.45);
      const guides = {
        lines: [
          { x1: -BIG, y1: 0, x2: BIG, y2: 0, color: ink, width: 1.25 },
          { x1: 0, y1: -BIG, x2: 0, y2: BIG, color: ink, width: 1.25 }
        ],
        segments: [],
        markers: [],
        labels: []
      };
      if (kind === 'under') {
        poles.forEach((p) => guides.lines.push({ x1: 0, y1: 0, x2: p.re, y2: p.im, color: hexToRgba(THEME.error, 0.7), dash: [4, 4] }));
        guides.labels.push({ x: poles[0].re, y: poles[0].im, dx: 10, dy: -12, text: poleLabel(poles[0]), short: poleLabel(poles[0]), color: THEME.output });
        const theta = Math.acos(d.zeta) * 180 / Math.PI;
        guides.labels.push({ x: poles[0].re / 2, y: poles[0].im / 2, dx: -6, dy: 14, align: 'right', text: `\u03b8 = ${fmt(theta, 1)}\u00b0, cos \u03b8 = \u03b6`, short: `\u03b8 = ${fmt(theta, 0)}\u00b0`, color: THEME.errorText });
      } else if (kind === 'critical') {
        guides.labels.push({ x: poles[0].re, y: 0, dx: 0, dy: -20, align: 'center', text: `${fmt(poles[0].re, 2)} (double)`, short: `${fmt(poles[0].re, 2)} \u00d72`, color: THEME.output });
      } else {
        poles.forEach((p, i) => guides.labels.push({ x: p.re, y: 0, dx: 0, dy: i === 0 ? -20 : 20, align: 'center', text: fmt(p.re, 2), short: fmt(p.re, 2), color: THEME.output }));
      }
      sGuides = guides;

      const [circleSet, refSet, poleSet] = sChart.data.datasets;
      circleSet.data = circle;
      poleSet.data = poles.map((p) => ({ x: p.re, y: p.im }));
      refSet.hidden = !ref;
      refSet.data = refPoles.map((p) => ({ x: p.re, y: p.im }));
      sChart.options.scales.x.min = -R;
      sChart.options.scales.x.max = 0.25 * R;
      sChart.options.scales.y.min = -0.625 * R;
      sChart.options.scales.y.max = 0.625 * R;
      sChart.update('none');

      const legend = [
        { label: 'Poles of G(s)', kind: 'dot', color: THEME.output },
        { label: 'Circle |s| = \u03c9n', kind: 'dashed', color: THEME.reference }
      ];
      if (kind === 'under') legend.push({ label: 'Lines at angle \u03b8 from the real axis', kind: 'dashed', color: THEME.error });
      if (ref) legend.push({ label: 'Pinned poles', kind: 'dot', color: THEME.reference });
      renderLegend(ui.sLegend, legend);
    }

    function updatePhasePlane(d, span, kind) {
      const steps = Math.min(40000, Math.max(2000, Math.ceil(span * d.wn * 40)));
      const sim = simulateStateSpace(d.m, d.b, d.k, d.F, span, steps);
      const every = Math.max(1, Math.floor(steps / 1500));
      const path = [];
      for (let i = 0; i < sim.length; i += every) path.push({ x: sim[i].x1, y: sim[i].x2, t: sim[i].t });

      let crossings = 0, gap = 0, prevSide = 0;
      sim.forEach((s) => {
        const side = Math.sign(s.x1 - d.K);
        if (side !== 0 && prevSide !== 0 && side !== prevSide) crossings++;
        if (side !== 0) prevSide = side;
        gap = Math.max(gap, Math.abs(s.x1 / d.K - SecondOrder.step(s.t, d.zeta, d.wn)));
      });
      ui.rk4Gap.textContent = gap < 1e-9 ? '< 1e-9' : gap.toExponential(1);

      if (pChart) drawPhase(d, path);
      ui.pChip.textContent = kind === 'under' ? 'spiral' : 'no spiral';
      ui.pChip.className = 'chip ' + (kind === 'under' ? 'chip--accent' : '');
      ui.pNote.textContent = kind === 'under'
        ? `The path spirals into the rest point and crosses the line x\u2081 = ${fmt(d.K, 3)} ${crossings} ${crossings === 1 ? 'time' : 'times'}: each crossing is one pass through the final value of the step response.`
        : 'The path goes straight from the start to the rest point without crossing the line x\u2081 = final. Velocity rises, peaks and dies away, and the position never overshoots.';
    }

    function drawPhase(d, path) {
      pGuides = {
        lines: [
          { x1: -BIG, y1: 0, x2: BIG, y2: 0, color: hexToRgba(THEME.ideal, 0.4), width: 1.25 },
          { x1: 0, y1: -BIG, x2: 0, y2: BIG, color: hexToRgba(THEME.ideal, 0.4), width: 1.25 },
          { x1: d.K, y1: -BIG, x2: d.K, y2: BIG, color: hexToRgba(THEME.error, 0.6), dash: [4, 4] }
        ],
        segments: [],
        markers: [{ x: 0, y: 0, color: THEME.tau }, { x: d.K, y: 0, color: THEME.error }],
        labels: [
          { x: 0, y: 0, dx: 10, dy: 14, text: 'start (0, 0)', short: 'start', color: THEME.tau },
          { x: d.K, y: 0, dx: 10, dy: 16, text: `rest x\u2081 = ${fmt(d.K, 3)}`, short: 'rest', color: THEME.errorText }
        ]
      };
      pChart.data.datasets[0].data = path;
      pChart.update('none');

      renderLegend(ui.pLegend, [
        { label: 'Path of (x\u2081, x\u2082) over the step', kind: 'line', color: THEME.output },
        { label: 'Start at rest', kind: 'dot', color: THEME.tau },
        { label: 'Final rest position', kind: 'dot', color: THEME.error }
      ]);
    }

    /* ---------- state-space panel ---------- */

    function matHTML(rows, decimals) {
      const cols = rows[0].length;
      const cells = rows.flat().map((v) => `<span>${typeof v === 'number' ? fmt(v, decimals) : v}</span>`).join('');
      return `<span class="mat"><span class="mat-grid" style="grid-template-columns:repeat(${cols},auto)">${cells}</span></span>`;
    }

    function updateStateSpace(d) {
      const A = [[0, 1], [-d.k / d.m, -d.b / d.m]];
      const B = [[0], [1 / d.m]];
      ui.ssLive.innerHTML =
        `<span class="ss-label">With your numbers</span>` +
        `<span class="math"><i>A</i> =${matHTML(A, 2)}&nbsp; <i>B</i> =${matHTML(B, 2)}&nbsp; <i>C</i> =${matHTML([[1, 0]], 0)}</span>`;
      const eig = SecondOrder.eigenvalues(d.m, d.b, d.k);
      const poles = SecondOrder.poles(d.zeta, d.wn);
      ui.eigList.innerHTML = eig.map((c, i) => `<li>\u03bb${i + 1} = ${fmtComplex(c)}</li>`).join('');
      ui.poleList.innerHTML = poles.map((c, i) => `<li>p${i + 1} = ${fmtComplex(c)}</li>`).join('');
      const diff = poleGap(eig, poles);
      const same = diff < 1e-6;
      ui.pzChip.textContent = same ? 'Same numbers' : 'They differ';
      ui.pzChip.className = 'chip ' + (same ? 'chip--pass' : 'chip--fail');
      ui.charPoly.textContent = `s\u00b2 + ${fmt(d.b / d.m, 2)}s + ${fmt(d.k / d.m, 2)}`;
      ui.ssChip.textContent = `m = ${fmt(d.m, 1)}, b = ${fmt(d.b, 2)}, k = ${fmt(d.k, 2)}`;
      ui.ssNote.textContent = state.mode === 'zw'
        ? `In the \u03b6 and \u03c9\u2099 view the mass is fixed at m = 1 kg, so b = 2\u03b6\u03c9\u2099 and k = \u03c9\u2099\u00b2. The force step is F = K\u00b7k = ${fmt(d.F, 2)} N, which gives the final position K = ${fmt(d.K, 2)}.`
        : `The force step is F = 1 N, so the final position is 1/k = ${fmt(d.K, 3)} m. In the standard form this is the gain K = 1/k.`;
    }

    /* ---------- validation ---------- */

    function validationChecks(d) {
      const t4 = measure(0.5, 2);
      const t5 = measure(1, 2);
      const eig = SecondOrder.eigenvalues(1, 2, 4);
      const poles = SecondOrder.poles(0.5, 2);
      const expected = sortPoles([{ re: -1, im: 1.732 }, { re: -1, im: -1.732 }]);
      const got = sortPoles(eig);
      const eigOk = got.every((p, i) => Math.abs(p.re - expected[i].re) <= 0.001 && Math.abs(p.im - expected[i].im) <= 0.001);
      const live = poleGap(SecondOrder.eigenvalues(d.m, d.b, d.k), SecondOrder.poles(d.zeta, d.wn));
      return [
        {
          name: 'Test 4: overshoot for \u03b6 = 0.5', detail: '\u03c9n = 2 rad/s, unit step',
          expected: { main: '16.3 %', sub: 'e^(\u2212\u03c0\u03b6/\u221a(1\u2212\u03b6\u00b2))' },
          calculated: { main: `${fmt(t4.mp, 2)} %`, sub: `peak y = ${fmt(t4.ymax, 4)}` },
          pass: Math.abs(t4.mp - 16.3) <= 0.05
        },
        {
          name: 'Test 5: overshoot for \u03b6 = 1', detail: '\u03c9n = 2 rad/s, critically damped',
          expected: { main: 'none', sub: '0 %' },
          calculated: { main: `${fmt(t5.mp, 2)} %`, sub: `max y = ${fmt(t5.ymax, 6)}` },
          pass: t5.mp === 0 && t5.ymax <= 1
        },
        {
          name: 'Test 6a: eigenvalues of A', detail: 'm = 1, b = 2, k = 4 (\u03b6 = 0.5, \u03c9n = 2)',
          expected: { main: '\u22121 \u00b1 j1.732', sub: 'from the slides' },
          calculated: { main: `${fmtComplex(eig[0])}`, sub: `and ${fmtComplex(eig[1])}` },
          pass: eigOk
        },
        {
          name: 'Test 6b: eigenvalues equal the poles', detail: 'same system, poles of G(s)',
          expected: { main: 'identical', sub: 'difference 0' },
          calculated: { main: `${fmtComplex(poles[0])}`, sub: `difference ${poleGap(eig, poles).toExponential(1)}` },
          pass: poleGap(eig, poles) < 1e-9
        },
        {
          name: 'Live: your current settings', detail: `m = ${fmt(d.m, 1)}, b = ${fmt(d.b, 2)}, k = ${fmt(d.k, 2)}`,
          expected: { main: 'eigenvalues = poles', sub: 'whatever you set' },
          calculated: { main: live < 1e-6 ? 'identical' : 'different', sub: `difference ${live < 1e-12 ? '< 1e-12' : live.toExponential(1)}` },
          pass: live < 1e-6
        }
      ];
    }

    /* ---------- main render ---------- */

    function render() {
      const d = derive(state);
      currentK = d.K;
      const kind = SecondOrder.classify(d.zeta);
      const met = measure(d.zeta, d.wn);
      const ref = visibleReference(d);
      const span = niceCeil(Math.max(1.5 * met.ts, 1));
      const ringing = kind === 'under' ? d.wn * Math.sqrt(1 - d.zeta * d.zeta) : d.wn;
      const n = Math.min(6000, Math.max(800, Math.ceil(span * ringing / (2 * Math.PI) * 24)));
      const times = Array.from({ length: n + 1 }, (_, i) => (i * span) / n);

      ui.caseChip.textContent = CASE_NAME[kind];
      ui.caseChip.className = 'chip ' + (kind === 'under' ? 'chip--accent' : '');
      renderLegend(ui.mainLegend, mainLegendItems(Number.isFinite(met.tp), ref));

      if (mainChart) {
        const [idealSet, outputSet, refSet] = mainChart.data.datasets;
        idealSet.data = [{ x: 0, y: d.K }, { x: span, y: d.K }];
        outputSet.data = times.map((t) => ({ x: t, y: d.K * SecondOrder.step(t, d.zeta, d.wn) }));
        refSet.hidden = !ref;
        refSet.label = ref ? `Reference (${refText(ref)})` : 'Reference';
        refSet.data = ref ? times.map((t) => ({ x: t, y: ref.K * SecondOrder.step(t, ref.zeta, ref.wn) })) : [];
        mainChart.options.scales.x.max = span;
        mainGuides = mainGuidesFor(d, met, span);
        mainChart.update('none');
      }
      if (sChart) updatePoleChart(d, kind, ref);
      updatePhasePlane(d, span, kind);
      ui.sChip.textContent = kind === 'under' ? 'complex pair' : kind === 'critical' ? 'double pole' : 'two real poles';
      updateStateSpace(d);

      // metrics
      const poles = SecondOrder.poles(d.zeta, d.wn);
      const slow = Math.min(...poles.map((p) => Math.abs(p.re)));
      $('m3-met-zeta').textContent = fmt(d.zeta, 2);
      $('m3-met-zeta-note').textContent = kind === 'under' ? 'Below 1: it rings.' : kind === 'critical' ? 'Exactly 1: fastest without ringing.' : 'Above 1: no ringing, but slow.';
      $('m3-met-wn').textContent = fmt(d.wn, 2);
      $('m3-met-wn-note').textContent = kind === 'under'
        ? `Rings at \u03c9d = ${fmt(ringing, 3)} rad/s (${fmt(ringing / (2 * Math.PI), 2)} Hz).`
        : `Undamped it would swing at ${fmt(d.wn / (2 * Math.PI), 2)} Hz.`;
      $('m3-met-tr').textContent = fmt(met.tr, 2);
      $('m3-met-tp').textContent = Number.isFinite(met.tp) ? fmt(met.tp, 2) : '\u2014';
      $('m3-met-tp-note').textContent = Number.isFinite(met.tp)
        ? `Formula \u03c0/\u03c9d = ${fmt(SecondOrder.peakTimeFormula(d.zeta, d.wn), 2)} s.`
        : 'There is no peak above the final value.';
      $('m3-met-mp').textContent = fmt(met.mp, 1);
      $('m3-met-mp-note').textContent = kind === 'under'
        ? `Formula e^(\u2212\u03c0\u03b6/\u221a(1\u2212\u03b6\u00b2)) = ${fmt(100 * SecondOrder.overshootFormula(d.zeta), 1)}%.`
        : 'Zero for \u03b6 \u2265 1.';
      $('m3-met-ts').textContent = fmt(met.ts, 2);
      $('m3-met-ts-note').textContent = kind === 'under'
        ? `Rule of thumb 4/(\u03b6\u03c9n) = ${fmt(4 / (d.zeta * d.wn), 2)} s.`
        : `The slow pole at \u2212${fmt(slow, 2)} sets the pace.`;

      // explanation for the current case
      if (kind === 'under') {
        ui.caseTitle.textContent = 'Underdamped: it overshoots and rings';
        ui.caseText.textContent = `With \u03b6 = ${fmt(d.zeta, 2)} the output passes the final value by ${fmt(met.mp, 1)}%, then oscillates at \u03c9d = ${fmt(ringing, 2)} rad/s while an envelope e^(\u2212\u03b6\u03c9n t) shrinks it. The poles are a complex pair off the real axis.`;
      } else if (kind === 'critical') {
        ui.caseTitle.textContent = 'Critically damped: as fast as possible without overshoot';
        ui.caseText.textContent = `\u03b6 = 1 puts a double pole at s = \u2212\u03c9n = \u2212${fmt(d.wn, 2)}. The output reaches the final value as quickly as it can without ever crossing it, and settles in ${fmt(met.ts, 2)} s.`;
      } else {
        ui.caseTitle.textContent = 'Overdamped: no overshoot, but sluggish';
        ui.caseText.textContent = `Two real poles, at \u2212${fmt(Math.max(...poles.map((p) => Math.abs(p.re))), 2)} and \u2212${fmt(slow, 2)}. The one nearer the origin dominates, so the sensor behaves almost like a first-order one with \u03c4 \u2248 1/${fmt(slow, 2)} = ${fmt(1 / slow, 2)} s.`;
      }

      const checks = validationChecks(d);
      const passed = renderValidation(ui.validationBody, checks);
      ui.validationSummary.textContent = `${passed} of ${checks.length} passed`;
      ui.validationSummary.className = 'chip ' + (passed === checks.length ? 'chip--pass' : 'chip--fail');

      const stored = state.reference;
      if (!stored) ui.refStatus.textContent = 'No reference curve. Pin the current curve to compare it with later settings.';
      else if (!ref) ui.refStatus.textContent = `Reference: ${refText(stored)}. It matches the live curve, so it is hidden until you change a setting.`;
      else ui.refStatus.textContent = `Dotted reference: ${refText(stored)}.`;
      ui.pin.disabled = Boolean(stored) && !ref;
      ui.unpin.disabled = !stored;

      ui.mainCanvas.setAttribute('aria-label',
        `${CASE_NAME[kind]} step response with damping ratio ${fmt(d.zeta, 2)} and natural frequency ${fmt(d.wn, 2)} radians per second. ` +
        `Rise time ${fmt(met.tr, 2)} s, overshoot ${fmt(met.mp, 1)} percent, settling time ${fmt(met.ts, 2)} s.`);
      ui.sCanvas.setAttribute('aria-label', `s-plane with ${kind === 'under' ? 'a complex pair' : kind === 'critical' ? 'a double pole' : 'two real poles'} at ${poles.map((p) => fmtComplex(p, 2)).join(' and ')}.`);
      ui.pCanvas.setAttribute('aria-label', kind === 'under' ? 'Phase plane: the path spirals into the rest point.' : 'Phase plane: the path goes to the rest point without spiralling.');
    }

    /* ---------- controls ---------- */

    function setSliderFill(slider) {
      const min = Number(slider.min), max = Number(slider.max);
      slider.style.setProperty('--fill', `${((Number(slider.value) - min) / (max - min)) * 100}%`);
    }

    const READOUTS = {
      zeta: (v) => v.toFixed(2), wn: (v) => `${v.toFixed(1)} rad/s`, K: (v) => v.toFixed(1),
      m: (v) => `${v.toFixed(1)} kg`, b: (v) => `${v.toFixed(1)} N\u00b7s/m`, k: (v) => `${v.toFixed(1)} N/m`
    };

    function syncControls() {
      Object.keys(ui.sliders).forEach((key) => {
        ui.sliders[key].value = String(state[key]);
        ui.outputs[key].textContent = READOUTS[key](state[key]);
        setSliderFill(ui.sliders[key]);
      });
      ui.modeRadios.forEach((r) => { r.checked = r.value === state.mode; });
      ui.setZW.hidden = state.mode !== 'zw';
      ui.setMBK.hidden = state.mode !== 'mbk';
      const d = derive(state);
      ui.modeHelp.textContent = state.mode === 'zw'
        ? 'The dimensionless view used on the slides. The mass is fixed at 1 kg for the state-space panel.'
        : 'The physical view: choose the parts, and \u03b6 and \u03c9n follow from them.';
      ui.derived.textContent = state.mode === 'zw'
        ? `Equivalent parts: m = 1 kg, b = ${fmt(d.b, 2)} N\u00b7s/m, k = ${fmt(d.k, 2)} N/m.`
        : `Result: \u03b6 = ${fmt(d.zeta, 3)}, \u03c9n = ${fmt(d.wn, 3)} rad/s, K = 1/k = ${fmt(d.K, 3)}.`;
    }

    function onControlChange() {
      syncControls();
      render();
      predict.notifyInteraction();
    }

    Object.keys(ui.sliders).forEach((key) => {
      ui.sliders[key].addEventListener('input', () => { state[key] = Number(ui.sliders[key].value); onControlChange(); });
    });
    ui.modeRadios.forEach((radio) => radio.addEventListener('change', () => {
      if (radio.checked) { switchMode(radio.value); onControlChange(); }
    }));
    document.querySelectorAll('.preset-list [data-zeta]').forEach((btn) => btn.addEventListener('click', () => {
      if (state.mode !== 'zw') switchMode('zw');
      state.zeta = Number(btn.dataset.zeta);
      onControlChange();
    }));

    function pinCurrentCurve() {
      const d = derive(state);
      state.reference = { zeta: d.zeta, wn: d.wn, K: d.K };
      render();
    }
    ui.pin.addEventListener('click', pinCurrentCurve);
    ui.unpin.addEventListener('click', () => { state.reference = null; render(); });
    ui.reset.addEventListener('click', () => {
      Object.assign(state, DEFAULTS);
      const d = derive(state);
      state.reference = { zeta: d.zeta, wn: d.wn, K: d.K };
      syncControls();
      render();
    });

    const predict = createPredictCheck($('m3-predict'), QUESTIONS, { onCheck: pinCurrentCurve });

    state.reference = (() => { const d = derive(state); return { zeta: d.zeta, wn: d.wn, K: d.K }; })();
    createCharts();
    syncControls();
    render();
  }

  initModule3();
  