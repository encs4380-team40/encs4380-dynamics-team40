
  'use strict';

  /* =========================================================================
     1. SHARED TOOLKIT HELPERS (copied from Homework 1, Module 1)
        Number formatting, chart theme, a small annotation plugin, legends,
        the validation table and the "Predict, then check" component.
        Homework 2 additions are marked "HW2".
     ========================================================================= */

  /** Colours used by every chart, kept in one place. */
  const THEME = {
    font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    text: '#475569',
    grid: '#e6ebf1',
    axis: '#cbd5e1',
    output: '#0f766e',     // sensor output y(t)
    ideal: '#1e293b',      // ideal gain-scaled input K·x(t)
    reference: '#94a3b8',  // pinned comparison curve
    tau: '#2563eb',        // anything that is "one time constant" (τ marker, time lag)
    tau3: '#0f172a',       // the 3τ marker
    error: '#d97706',      // output error, drawn lines
    errorText: '#b45309',  // output error, text (darker for contrast)
    // HW2 colours
    setpoint: '#1e293b',   // setpoint r(t), dashed
    sensor: '#c2410c',     // sensor measurement m(t) (P2), dashed orange
    control: '#2563eb',    // control signal u(t)
    limit: '#b91c1c',      // actuator limits u_min and u_max
    pTerm: '#7c3aed',      // proportional part Kp·e
    iTerm: '#d97706',      // integral part Ki·∫e
    dTerm: '#db2777',      // derivative part
    saturated: 'rgba(185, 28, 28, 0.08)'   // shading while u is held at a limit
  };

  /** True when the bundled Chart.js script loaded. */
  const CHARTS_AVAILABLE = typeof window.Chart === 'function';

  /** Format a number with fixed decimals and a true minus sign (−). */
  function fmt(value, decimals = 3) {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.abs(value) < 0.5 * Math.pow(10, -decimals) ? 0 : value;
    const text = rounded.toFixed(decimals);
    return text.charAt(0) === '-' ? '\u2212' + text.slice(1) : text;
  }

  /** Short axis-tick format: 2.50 → "2.5", 12.00 → "12". */
  function fmtTick(value) {
    return String(Number(value.toFixed(2)));
  }

  /** Escape text before inserting it into HTML. */
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  /** "#rrggbb" → "rgba(r, g, b, alpha)". */
  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /** Global Chart.js look: fonts and colours. */
  function applyChartDefaults() {
    Chart.defaults.font.family = THEME.font;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = THEME.text;
    Chart.defaults.borderColor = THEME.grid;
  }

  /** Dark tooltip style shared by all charts. */
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

  /**
   * Time axis from 0 to spanInTau·τ with one tick (and gridline) per time constant.
   * Each tick label has two lines: the time in seconds and the multiple of τ.
   * getTau() is called on every redraw, so the axis follows the τ slider.
   */
  function tauTimeAxis(getTau, spanInTau) {
    return {
      type: 'linear',
      min: 0,
      max: spanInTau * getTau(),
      title: { display: true, text: 'Time t (s)', font: { weight: '600' } },
      grid: { color: THEME.grid },
      border: { color: THEME.axis },
      ticks: {
        autoSkip: false,
        maxRotation: 0,
        callback: (value) => {
          const n = Math.round(value / getTau());
          return [fmtTick(value), n === 0 ? '' : n === 1 ? 'τ' : n + 'τ'];
        }
      },
      afterBuildTicks: (axis) => {
        const tau = getTau();
        axis.ticks = Array.from({ length: spanInTau + 1 }, (_, n) => ({ value: n * tau }));
      }
    };
  }

  /* ---------- Annotation plugin ----------
     Draws teaching annotations in data coordinates (no extra library):
       lines    – thin dashed guides, drawn BEHIND the curves
       segments – emphasised segments (optional end caps), drawn ON TOP
       markers  – filled circles on characteristic points
       labels   – short text tags on a white background
       spans    – HW2: shaded time intervals (x1 … x2, full height), drawn BEHIND the curves
     getGuides() returns { spans, lines, segments, markers, labels } for the current state. */
  function createGuidesPlugin(getGuides) {
    return {
      id: 'teachingGuides',
      beforeDatasetsDraw(chart) {
        const guides = getGuides();
        if (guides) drawClipped(chart, () => {
          (guides.spans || []).forEach((s) => drawSpan(chart, s));
          (guides.lines || []).forEach((s) => drawSegment(chart, s));
        });
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

  /** Run a drawing function clipped to the plotting area. */
  function drawClipped(chart, drawFn) {
    const { ctx, chartArea: a } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top);
    ctx.clip();
    drawFn();
    ctx.restore();
  }

  /** HW2: shaded vertical band between x1 and x2 (for example "the actuator is saturated here"). */
  function drawSpan(chart, s) {
    const { ctx, chartArea: a } = chart;
    const x1 = chart.scales.x.getPixelForValue(s.x1);
    const x2 = chart.scales.x.getPixelForValue(s.x2);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return;
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.min(x1, x2), a.top, Math.max(1, Math.abs(x2 - x1)), a.bottom - a.top);
    ctx.restore();
  }

  /** Data coordinates → canvas pixels. */
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
    if (s.caps) {                                   // short perpendicular ticks at both ends
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

  /** Rounded rectangle path (ctx.roundRect is missing in some older browsers). */
  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Text tag anchored at (x, y) + (dx, dy) px, kept inside the plotting area. */
  function drawLabel(chart, label) {
    const p = toPixels(chart, label.x, label.y, label.yAxis);
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) return;
    const { ctx, chartArea: area } = chart;
    const narrow = area.right - area.left < 440;     // phones: use the short text
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

  /* ---------- HTML legend (matches the line styles drawn on the canvas) ---------- */
  const LEGEND_SWATCHES = {
    line:   (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2.75" stroke-linecap="round"/>`,
    dashed: (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2" stroke-dasharray="6 4"/>`,
    dotted: (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2" stroke-dasharray="2 3"/>`,
    dot:    (c) => `<circle cx="12" cy="6" r="4.5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`,
    vbar:   (c) => `<path d="M12 1.5v9M9 1.5h6M9 10.5h6" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    hbar:   (c) => `<path d="M3 6h18M3 3v6M21 3v6" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  };

  /** items: [{ label, kind: 'line'|'dashed'|'dotted'|'dot'|'vbar'|'hbar', color }] */
  function renderLegend(listEl, items) {
    listEl.innerHTML = items.map((item) =>
      `<li><svg class="legend-swatch" viewBox="0 0 24 12" width="24" height="12" aria-hidden="true">${LEGEND_SWATCHES[item.kind](item.color)}</svg>${escapeHtml(item.label)}</li>`
    ).join('');
  }

  /* ---------- Validation table ----------
     checks: [{ name, detail, expected: { main, sub }, calculated: { main, sub }, pass }]
     Returns the number of passing checks. Reusable by Modules 2 and 3. */
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
    td.dataset.label = label;                      // used by the stacked phone layout
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

  /* ---------- "Predict, then check" component ----------
     root: the activity card (uses data-role attributes for its parts).
     questions: [{ prompt, choices: [{ text, correct }], explanation, tryIt }]
     hooks.onCheck(question, isCorrect) runs after each check.
     Returns { notifyInteraction() } — call it when the user moves a control. */
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

    /** stage: 'predict' | 'observe' | 'done' */
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


  /* =========================================================================
     PID SIMULATION ENGINE (pure functions, no page access)
     The same engine is embedded, unchanged, in P1 (modules/p1/p1.html) and
     P2 (modules/p2/p2.html), so each page works on its own. P3, P4 and the
     MySystem page can copy this block as well.

     Closed loop simulated here:

        r ──►(Σ)── e ──► PID ── u_raw ──► [limit] ── u ──► plant ──► y
              ▲ −                                                  │
              └──────────── m ◄── sensor H_s(s) ◄──────────────────┘

       Plant (first order, Module 1):   τ dy/dt = K·u − y            G(s) = K / (τs + 1)
       Plant (second order, Module 3):  ÿ + 2ζω_n ẏ + ω_n² y = K ω_n² u
                                                           G(s) = K ω_n² / (s² + 2ζω_n s + ω_n²)
       Sensor:                          τ_s dm/dt = y − m            H_s(s) = 1 / (τ_s s + 1)
                                        τ_s = 0 means an ideal sensor, m = y (no division)
       Controller (parallel PID):       e = r − m
                                        u_raw = Kp·e + Ki·∫e dt + Kd·(filtered derivative)
                                        u = min(max(u_raw, u_min), u_max)   ← enforced, not just drawn
       Derivative: d/dt is replaced by s / (T_f s + 1) with T_f = 0.01 s, so a step
       in e gives a tall but finite "derivative kick" instead of an infinite impulse.
       It can act on the error e (the textbook form) or on −m (no kick on setpoint steps).
       There is no anti-windup here: the integral keeps integrating e even while u is
       limited. (P3 adds anti-windup.)

     Solver: classic fourth-order Runge–Kutta (RK4) with a fixed step Δt chosen
     from the fastest pole of the loop (Δt = 0.25 / |p|max, never above 1 ms).
     ========================================================================= */
  const PidEngine = (function () {
    'use strict';

    const DERIV_TF = 0.01;          // derivative filter time constant T_f (s)
    const SETTLE_BAND = 0.02;       // ±2 % settling band, as in Module 3
    const CONVERGE_TOL = 1e-3;      // "converged": y varies by ≤ 0.1 % of |r| over the last 20 % of the run
    const DIVERGE_LIMIT = 1e4;      // |y| above 10 000·|r| counts as unstable
    const MAX_STEPS = 2000000;       // safety cap on RK4 steps per run

    /* ---------- Small polynomial toolkit (coefficients in ascending powers of s) ---------- */
    function polyMul(a, b) {
      const out = new Array(a.length + b.length - 1).fill(0);
      a.forEach((ai, i) => b.forEach((bj, j) => { out[i + j] += ai * bj; }));
      return out;
    }
    function polyAdd(a, b) {
      const out = new Array(Math.max(a.length, b.length)).fill(0);
      a.forEach((v, i) => { out[i] += v; });
      b.forEach((v, i) => { out[i] += v; });
      return out;
    }
    function polyTrim(p) {
      const out = p.slice();
      while (out.length > 1 && Math.abs(out[out.length - 1]) < 1e-14) out.pop();
      return out;
    }

    /** All complex roots of a real polynomial (ascending coefficients), Durand–Kerner iteration. */
    function polyRoots(coeffs) {
      const p = polyTrim(coeffs);
      const n = p.length - 1;
      if (n < 1) return [];
      const lead = p[n];
      const a = p.map((c) => c / lead);                    // monic
      const evalAt = (zr, zi) => {                          // Horner in complex arithmetic
        let re = 1, im = 0;
        for (let k = n - 1; k >= 0; k--) {
          const nr = re * zr - im * zi + a[k];
          im = re * zi + im * zr;
          re = nr;
        }
        return [re, im];
      };
      const bound = 1 + Math.max(...a.slice(0, n).map(Math.abs));
      let roots = Array.from({ length: n }, (_, k) => {
        const ang = (2 * Math.PI * k) / n + 0.4;
        return [0.5 * bound * Math.cos(ang), 0.5 * bound * Math.sin(ang)];
      });
      for (let iter = 0; iter < 2000; iter++) {
        let delta = 0;
        roots = roots.map(([zr, zi], i) => {
          let [nr, ni] = evalAt(zr, zi);
          roots.forEach(([wr, wi], j) => {
            if (j === i) return;
            const dr = zr - wr, di = zi - wi;
            const den = dr * dr + di * di || 1e-30;
            const qr = (nr * dr + ni * di) / den;            // (nr + j ni) / (dr + j di)
            const qi = (ni * dr - nr * di) / den;
            nr = qr; ni = qi;
          });
          delta = Math.max(delta, Math.hypot(nr, ni));
          return [zr - nr, zi - ni];
        });
        if (delta < 1e-13 * bound) break;
      }
      return roots.map(([re, im]) => ({ re, im: Math.abs(im) < 1e-9 * bound ? 0 : im }));
    }

    /* ---------- Configuration ---------- */

    /** Fill in defaults and validate. Throws a readable Error on a bad value. */
    function normalise(config) {
      const c = Object.assign({
        plant: { type: 'first', K: 1, tau: 1 },
        sensorTau: 0, Kp: 1, Ki: 0, Kd: 0, r: 1,
        uMin: -Infinity, uMax: Infinity, dMode: 'error', disturbance: null
      }, config);
      const p = c.plant;
      const bad = (msg) => { throw new Error(msg); };
      if (!(p.K > 0)) bad('The plant gain K must be positive.');
      if (p.type === 'first' && !(p.tau > 0)) bad('The plant time constant τ must be positive.');
      if (p.type === 'second' && (!(p.zeta >= 0) || !(p.wn > 0))) bad('ζ must be ≥ 0 and ω_n must be positive.');
      if (!(c.sensorTau >= 0)) bad('The sensor time constant τ_s cannot be negative.');
      if ([c.Kp, c.Ki, c.Kd].some((g) => !(g >= 0))) bad('The PID gains must be zero or positive.');
      if (!(c.uMax > c.uMin)) bad('The upper control limit must be above the lower limit.');
      if (!Number.isFinite(c.r) || c.r === 0) bad('The setpoint step must be a non-zero number.');
      return c;
    }

    /** Closed-loop characteristic polynomial of the linear (unsaturated) loop: Cd·Gd·Hd + Cn·Gn·Hn. */
    function characteristicPolynomial(config) {
      const c = normalise(config);
      const p = c.plant;
      const Gn = p.type === 'first' ? [p.K] : [p.K * p.wn * p.wn];
      const Gd = p.type === 'first' ? [1, p.tau] : [p.wn * p.wn, 2 * p.zeta * p.wn, 1];
      const Hn = [1];
      const Hd = c.sensorTau > 0 ? [1, c.sensorTau] : [1];
      let Cn = [c.Kp];
      let Cd = [1];
      if (c.Ki > 0) { Cn = [c.Ki, c.Kp]; Cd = [0, 1]; }                 // Kp + Ki/s
      if (c.Kd > 0) {                                                    // + Kd s/(T_f s + 1)
        Cn = polyAdd(polyMul(Cn, [1, DERIV_TF]), polyMul([0, c.Kd], Cd));
        Cd = polyMul(Cd, [1, DERIV_TF]);
      }
      return polyTrim(polyAdd(polyMul(polyMul(Cd, Gd), Hd), polyMul(polyMul(Cn, Gn), Hn)));
    }

    /** Closed-loop poles and a stability verdict for the unsaturated loop. */
    function analyse(config) {
      const poles = polyRoots(characteristicPolynomial(config));
      const maxRe = Math.max(...poles.map((q) => q.re));
      const scale = Math.max(1, ...poles.map((q) => Math.hypot(q.re, q.im)));
      const stable = maxRe < -1e-9 * scale;
      const marginal = !stable && maxRe <= 1e-7 * scale;
      return { poles, maxRe, stable, marginal };
    }

    /* ---------- Simulation ---------- */
    // State vector: [y, v, m, I, f]
    //   y plant output, v = dy/dt (second-order plant only), m sensor reading (τ_s > 0 only),
    //   I = ∫e dt, f = derivative-filter state.
    function makeModel(c) {
      const p = c.plant;
      const second = p.type === 'second';
      const hasSensor = c.sensorTau > 0;
      const hasD = c.Kd > 0;
      const dist = c.disturbance;

      /** Every signal of the loop at time t for state x (used by the solver and for recording). */
      function signals(t, x) {
        const y = x[0];
        const m = hasSensor ? x[2] : y;                 // ideal sensor: the controller sees y itself
        const e = c.r - m;                              // the controller only sees the measurement
        const q = c.dMode === 'measurement' ? -m : e;   // what the derivative acts on
        const P = c.Kp * e;
        const I = c.Ki * x[3];
        const D = hasD ? (c.Kd * (q - x[4])) / DERIV_TF : 0;
        const uRaw = P + I + D;
        const u = Math.min(Math.max(uRaw, c.uMin), c.uMax);
        const d = dist && t >= dist.time ? dist.size : 0;
        return { y, m, e, q, P, I, D, uRaw, u, d, saturated: u !== uRaw };
      }

      /** Right-hand side dx/dt, written into `dx` (no allocation: this runs four times per step). */
      function deriv(t, x, dx) {
        const s = signals(t, x);
        const w = s.u + s.d;                            // plant input (control + load disturbance)
        if (second) {
          dx[0] = x[1];
          dx[1] = p.wn * p.wn * (p.K * w - x[0]) - 2 * p.zeta * p.wn * x[1];
        } else {
          dx[0] = (p.K * w - x[0]) / p.tau;
          dx[1] = 0;
        }
        dx[2] = hasSensor ? (x[0] - x[2]) / c.sensorTau : 0;
        dx[3] = s.e;
        dx[4] = hasD ? (s.q - x[4]) / DERIV_TF : 0;
        return dx;
      }

      // States that actually exist for this configuration (used for linearisation).
      const active = [0];
      if (second) active.push(1);
      if (hasSensor) active.push(2);
      if (c.Ki > 0) active.push(3);
      if (hasD) active.push(4);
      return { signals, deriv, active };
    }

    /** One classic RK4 step of length dt, in place on x (scratch arrays are reused). */
    const K1 = new Float64Array(5), K2 = new Float64Array(5), K3 = new Float64Array(5), K4 = new Float64Array(5);
    const XT = new Float64Array(5);
    function rk4Step(deriv, t, x, dt) {
      deriv(t, x, K1);
      for (let i = 0; i < 5; i++) XT[i] = x[i] + 0.5 * dt * K1[i];
      deriv(t + 0.5 * dt, XT, K2);
      for (let i = 0; i < 5; i++) XT[i] = x[i] + 0.5 * dt * K2[i];
      deriv(t + 0.5 * dt, XT, K3);
      for (let i = 0; i < 5; i++) XT[i] = x[i] + dt * K3[i];
      deriv(t + dt, XT, K4);
      for (let i = 0; i < 5; i++) x[i] += (dt / 6) * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]);
    }

    /** Step size from the fastest pole of the loop (closed loop, open loop, sensor and filter). */
    function chooseStep(c, lin) {
      const p = c.plant;
      const rates = lin.poles.map((q) => Math.hypot(q.re, q.im));
      rates.push(p.type === 'first' ? 1 / p.tau : p.wn);
      if (c.sensorTau > 0) rates.push(1 / c.sensorTau);
      if (c.Kd > 0) rates.push(1 / DERIV_TF);
      const fastest = Math.max(...rates);
      return Math.min(1e-3, Math.max(2e-5, 0.25 / fastest));
    }

    /** Horizon long enough for the slowest stable pole to die out (≈ 6 time constants, ×2 margin). */
    function chooseHorizon(lin) {
      if (!lin.stable) return 20;
      const slowest = Math.min(...lin.poles.map((q) => Math.abs(q.re)));
      return Math.min(60, Math.max(3, 12 / slowest));
    }

    /**
     * Simulate the closed loop for a step r applied at t = 0 (zero initial state).
     * options.horizon fixes the run length; otherwise it is chosen from the poles (at least
     * options.minHorizon) and
     * doubled (up to 120 s) while a stable response has not converged yet.
     * Returns arrays of every recorded signal plus the analysis and the step size used.
     */
    function simulate(config, options = {}) {
      const c = normalise(config);
      const lin = analyse(c);
      const dt = options.dt || chooseStep(c, lin);
      let horizon = options.horizon || Math.max(chooseHorizon(lin), options.minHorizon || 0);
      const model = makeModel(c);
      const limit = DIVERGE_LIMIT * Math.max(1, Math.abs(c.r));

      const rec = { t: [], y: [], m: [], e: [], u: [], uRaw: [], P: [], I: [], D: [], sat: [] };
      const record = (t, x) => {
        const s = model.signals(t, x);
        rec.t.push(t); rec.y.push(s.y); rec.m.push(s.m); rec.e.push(s.e);
        rec.u.push(s.u); rec.uRaw.push(s.uRaw); rec.P.push(s.P); rec.I.push(s.I); rec.D.push(s.D);
        rec.sat.push(s.saturated);
      };

      // Record about 20 000 samples per run (every step when Δt is already that coarse).
      const every = Math.max(1, Math.floor(horizon / 20000 / dt));
      const x = new Float64Array(5);
      let t = 0;
      let k = 0;
      let diverged = false;
      record(t, x);
      for (;;) {
        const steps = Math.round(horizon / dt);
        while (k < steps && k < MAX_STEPS) {
          rk4Step(model.deriv, t, x, dt);
          k += 1;
          t = k * dt;
          if (k % every === 0 || k === steps) record(t, x);
          if (!(Number.isFinite(x[0]) && Number.isFinite(x[3])) || Math.abs(x[0]) > limit) {
            if (k % every !== 0) record(t, x);
            diverged = true;
            break;
          }
        }
        if (diverged || options.horizon || !lin.stable || k >= MAX_STEPS || horizon >= 120) break;
        if (convergence(rec, c.r).converged) break;
        horizon = Math.min(120, horizon * 2);           // slow (often saturated) response: run longer
      }
      return { config: c, analysis: lin, dt, horizon: t, diverged, model, rec };
    }

    /* ---------- Performance metrics ---------- */

    function convergence(rec, r) {
      const n = rec.y.length;
      const tEnd = rec.t[n - 1];
      let lo = Infinity, hi = -Infinity;
      for (let i = n - 1; i >= 0 && rec.t[i] >= 0.8 * tEnd; i--) {
        lo = Math.min(lo, rec.y[i]);
        hi = Math.max(hi, rec.y[i]);
      }
      return { converged: hi - lo <= CONVERGE_TOL * Math.abs(r), spread: hi - lo };
    }

    /** First time the signal crosses `level` going toward the final value (linear interpolation). */
    function firstCrossing(t, y, level, sign) {
      for (let i = 1; i < y.length; i++) {
        if (sign * (y[i] - level) >= 0) {
          const a = y[i - 1], b = y[i];
          const frac = b === a ? 0 : (level - a) / (b - a);
          return t[i - 1] + frac * (t[i] - t[i - 1]);
        }
      }
      return NaN;
    }

    /**
     * Metrics of a signal (default y) for a step 0 → r. All relative to the FINAL VALUE y_ss,
     * as in Modules 1 and 3: rise time 10 %→90 % of y_ss, overshoot (y_max − y_ss)/|y_ss|,
     * settling time = last exit from the ±2 % band around y_ss, e_ss = r − y_ss.
     * Nothing is reported as a number unless the run converged.
     */
    function metrics(result, signal = 'y') {
      const { rec, config, diverged } = result;
      const r = config.r;
      const y = rec[signal];
      const t = rec.t;
      const n = y.length;
      const out = { status: 'ok', reason: '', yss: NaN, ess: NaN, essPct: NaN, tr: NaN, mp: NaN, ts: NaN,
                    yPeak: NaN, tPeak: NaN, t10: NaN, t90: NaN, peakU: 0, satTime: 0, horizon: t[n - 1] };

      // Control-effort facts are meaningful even for bad responses.
      for (let i = 1; i < n; i++) if (rec.sat[i]) out.satTime += t[i] - t[i - 1];
      for (let i = 0; i < n; i++) out.peakU = Math.max(out.peakU, Math.abs(rec.u[i]));
      let peakIdx = 0;
      for (let i = 1; i < n; i++) if (Math.sign(r) * y[i] > Math.sign(r) * y[peakIdx]) peakIdx = i;
      out.yPeak = y[peakIdx];
      out.tPeak = t[peakIdx];

      if (diverged) {
        out.status = 'unstable';
        out.reason = `The output grew without bound (|y| passed ${fmtNum(DIVERGE_LIMIT * Math.abs(r))} at t = ${fmtNum(t[n - 1])} s).`;
        return out;
      }
      const conv = convergence(rec, r);
      if (!conv.converged) {
        out.status = result.analysis.stable ? 'not-settled' : 'oscillating';
        out.reason = result.analysis.stable
          ? `Still moving after ${fmtNum(t[n - 1])} s: y varies by ${fmtNum(conv.spread)} over the last 20 % of the run.`
          : `The loop is not stable: y keeps swinging by ${fmtNum(conv.spread)} after ${fmtNum(t[n - 1])} s.`;
        return out;
      }
      const yss = y[n - 1];
      out.yss = yss;
      out.ess = r - yss;
      out.essPct = (100 * (r - yss)) / r;
      if (Math.sign(yss) !== Math.sign(r) || Math.abs(yss) < 0.01 * Math.abs(r)) {
        out.status = 'no-response';
        out.reason = 'The output settles at (almost) zero or on the wrong side, so rise time and overshoot are undefined.';
        return out;
      }
      const sign = Math.sign(yss);
      out.t10 = firstCrossing(t, y, 0.1 * yss, sign);
      out.t90 = firstCrossing(t, y, 0.9 * yss, sign);
      out.tr = out.t90 - out.t10;
      out.mp = Math.max(0, (100 * sign * (out.yPeak - yss)) / Math.abs(yss));
      const band = SETTLE_BAND * Math.abs(yss);
      let ts = 0;
      for (let i = n - 2; i > 0; i--) {
        if (Math.abs(y[i] - yss) > band) {                // last sample outside the band
          const a = Math.abs(y[i] - yss), b = Math.abs(y[i + 1] - yss);
          ts = t[i] + ((a - band) / (a - b)) * (t[i + 1] - t[i]);
          break;
        }
      }
      out.ts = ts;
      return out;
    }

    function fmtNum(v) {
      const a = Math.abs(v);
      return a >= 1000 || (a > 0 && a < 0.01) ? v.toExponential(2) : v.toFixed(a >= 100 ? 0 : 3);
    }

    /**
     * Linearise the simulated loop at the origin by finite differences of the solver's own
     * right-hand side (the unsaturated region). Returns the Jacobian on the active states.
     * Used by the validation to measure ω_n and ζ from the implementation itself.
     */
    function linearise(config) {
      const c = normalise(Object.assign({}, config, { r: 1 }));
      const model = makeModel(Object.assign({}, c, { uMin: -Infinity, uMax: Infinity }));
      const idx = model.active;
      const h = 1e-6;
      const base = [0, 0, 0, 0, 0];
      // With r applied the operating point is irrelevant for a linear system: differentiate around 0.
      return idx.map((row) => idx.map((col) => {
        const xp = base.slice(); xp[col] += h;
        const xm = base.slice(); xm[col] -= h;
        return (model.deriv(1, xp, [0, 0, 0, 0, 0])[row] - model.deriv(1, xm, [0, 0, 0, 0, 0])[row]) / (2 * h);
      }));
    }

    /** Value of a recorded signal at time tq (linear interpolation). */
    function valueAt(rec, key, tq) {
      const t = rec.t;
      if (tq <= t[0]) return rec[key][0];
      for (let i = 1; i < t.length; i++) {
        if (t[i] >= tq) {
          const f = (tq - t[i - 1]) / (t[i] - t[i - 1]);
          return rec[key][i - 1] + f * (rec[key][i] - rec[key][i - 1]);
        }
      }
      return rec[key][t.length - 1];
    }

    /**
     * Reduce a recorded signal to about `buckets` × 2 chart points between t0 and t1, keeping the
     * minimum and maximum of each bucket so short spikes (derivative kick, saturation) stay visible.
     */
    function decimate(rec, key, t0, t1, buckets = 400) {
      const t = rec.t, v = rec[key];
      const out = [];
      const width = (t1 - t0) / buckets;
      let i = 0;
      while (i < t.length && t[i] < t0) i++;
      for (let b = 0; b < buckets && i < t.length; b++) {
        const end = t0 + (b + 1) * width;
        let iMin = i, iMax = i;
        const start = i;
        while (i < t.length && t[i] <= end + 1e-12) {
          if (v[i] < v[iMin]) iMin = i;
          if (v[i] > v[iMax]) iMax = i;
          i++;
        }
        if (i === start) continue;
        const first = Math.min(iMin, iMax), second = Math.max(iMin, iMax);
        out.push({ x: t[first], y: v[first] });
        if (second !== first) out.push({ x: t[second], y: v[second] });
      }
      return out;
    }

    return {
      DERIV_TF, SETTLE_BAND, CONVERGE_TOL,
      simulate, metrics, analyse, characteristicPolynomial, polyRoots, linearise, valueAt, decimate, normalise
    };
  })();


  /* =========================================================================
     CONTROL-PAGE HELPERS (HW2): small UI pieces shared by P1 and P2.
     Slider wiring, chart axes, the time window, saturation shading and the
     closed-loop pole text. Each page has its own copy so it works alone.
     ========================================================================= */
  const ControlKit = (function () {
    'use strict';

    /** Paint the slider track up to the thumb (same look as Homework 1). */
    function setSliderFill(slider) {
      const min = Number(slider.min);
      const max = Number(slider.max);
      const pct = ((Number(slider.value) - min) / (max - min)) * 100;
      slider.style.setProperty('--fill', `${pct}%`);
    }

    /** Round up to 1, 1.5, 2, 3, 4, 5, 6, 8 × 10^n (a tidy axis end). */
    function niceCeil(x) {
      if (!(x > 0)) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(x)));
      const m = x / p;
      const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => s >= m - 1e-9);
      return step * p;
    }

    /** Automatic time window: the settling time (or the peak) plus 60 %, or the whole run when it never settles. */
    function autoWindow(result, met) {
      if (met.status === 'ok') {
        const t = Math.max(met.ts, met.mp > 0.05 ? met.tPeak : 0, met.t90 || 0, 0.05);
        return Math.min(niceCeil(1.6 * t), niceCeil(result.horizon));
      }
      return result.horizon;
    }

    /** Linear tick spacing that gives about 6–10 gridlines. */
    function tickStep(span) {
      const raw = span / 8;
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
    }

    /** Time axis 0 … window (seconds). */
    function timeAxis() {
      return {
        type: 'linear', min: 0, max: 1,
        title: { display: true, text: 'Time t (s)', font: { weight: '600' } },
        grid: { color: THEME.grid },
        border: { color: THEME.axis },
        ticks: { maxRotation: 0, callback: (v) => fmtTick(v).replace('-', '\u2212') },
        afterBuildTicks: (axis) => {
          const step = tickStep(axis.max - axis.min);
          const ticks = [];
          for (let v = 0; v <= axis.max + 1e-9; v += step) ticks.push({ value: Number(v.toFixed(10)) });
          axis.ticks = ticks;
        }
      };
    }

    /** y-range that holds all values, with 8 % padding; an unstable response is clipped to a readable range. */
    function valueRange(values, clip) {
      let lo = Math.min(...values);
      let hi = Math.max(...values);
      if (clip) { lo = Math.max(lo, clip[0]); hi = Math.min(hi, clip[1]); }
      if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
      const pad = 0.08 * (hi - lo);
      return [lo - pad, hi + pad];
    }

    /** Min and max of a recorded signal inside [0, tEnd]. */
    function extent(rec, key, tEnd) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < rec.t.length && rec.t[i] <= tEnd + 1e-12; i++) {
        const v = rec[key][i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return [lo, hi];
    }

    /** Time intervals in which the actuator was held at a limit, as shaded spans. */
    function saturationSpans(rec, tEnd) {
      const spans = [];
      let start = null;
      for (let i = 0; i < rec.t.length && rec.t[i] <= tEnd; i++) {
        if (rec.sat[i] && start === null) start = rec.t[i];
        if (!rec.sat[i] && start !== null) { spans.push({ x1: start, x2: rec.t[i], color: THEME.saturated }); start = null; }
      }
      if (start !== null) spans.push({ x1: start, x2: Math.min(tEnd, rec.t[rec.t.length - 1]), color: THEME.saturated });
      return spans;
    }

    /** "−2.000 ± j3.162" style text for the closed-loop poles (conjugate pairs listed once). */
    function polesText(poles) {
      const list = [];
      poles.slice().sort((a, b) => b.re - a.re || b.im - a.im).forEach((p) => {
        if (Math.abs(p.im) <= 1e-6) list.push(fmt(p.re, 3));          // real pole (repeated poles are listed twice)
        else if (p.im > 0) list.push(`${fmt(p.re, 3)} ± j${fmt(p.im, 3)}`);   // complex pair, listed once
      });
      return list.join(',  ');
    }

    /** Write text into every element marked data-bd="key" (both block-diagram layouts). */
    function setDiagramText(root, key, text) {
      root.querySelectorAll(`[data-bd="${key}"]`).forEach((el) => { el.textContent = text; });
    }

    /** Format a metric for a card: the value, or "—" when it is undefined. */
    function metricText(value, decimals) {
      return Number.isFinite(value) ? fmt(value, decimals) : '—';
    }

    /** Short human sentence for a non-ok metrics status. */
    function statusSentence(met) {
      switch (met.status) {
        case 'unstable': return { cls: 'bad', title: 'Unstable.', text: met.reason };
        case 'oscillating': return { cls: 'bad', title: 'Unstable / oscillating.', text: met.reason + ' Rise time, overshoot, settling time and steady-state error are not defined, so none is reported.' };
        case 'not-settled': return { cls: 'warn', title: 'Not settled yet.', text: met.reason + ' The metrics are left blank rather than guessed.' };
        case 'no-response': return { cls: 'warn', title: 'No useful response.', text: met.reason };
        default: return null;
      }
    }

    /** Run a function at most once per animation frame (slider dragging stays smooth). */
    function frameThrottle(fn) {
      let queued = false;
      return function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fn(); });
      };
    }

    return {
      setSliderFill, niceCeil, autoWindow, timeAxis, valueRange, extent, saturationSpans,
      polesText, setDiagramText, metricText, statusSentence, frameThrottle
    };
  })();


  /* =========================================================================
     CONTROL P2: A SLOW SENSOR IN THE LOOP (user interface)
     Same plant, PID and limits as P1; the loop is closed through a first-order
     sensor, so PidEngine computes e = r − m (never r − y).
     ========================================================================= */
  function initP2() {
    const DEMO = Object.freeze({ plant: 'first', K: 1, tau: 1, Kp: 3, Ki: 10, Kd: 0, r: 1, uMax: 10, uMin: -10, dMode: 'error' });
    const DEFAULTS = Object.freeze(Object.assign({}, DEMO, { zeta: 0.5, wn: 2, sensorTau: 0.1, window: 'auto' }));
    const PRESETS = {
      first:  { P: { Kp: 9, Ki: 0, Kd: 0 }, PI: { Kp: 3, Ki: 10, Kd: 0 }, PID: { Kp: 3, Ki: 10, Kd: 0.2 } },
      second: { P: { Kp: 5, Ki: 0, Kd: 0 }, PI: { Kp: 5, Ki: 5, Kd: 0 }, PID: { Kp: 5, Ki: 5, Kd: 1 } }
    };
    const PRESET_HELP = {
      first: 'First-order plant: P = 9 (never unstable, but rings more as τs grows), PI = 3 / 10 (the demonstration: unstable above τs ≈ 0.67 s), PID adds Kd = 0.2.',
      second: 'Second-order plant: P = 5, PI = 5 / 5, PID = 5 / 5 / 1. With the plant’s own inertia, even a small τs matters.'
    };
    const SWEEP_POINTS = 31;

    const state = Object.assign({}, DEFAULTS, { reference: null });
    const $ = (id) => document.getElementById(id);

    const SLIDERS = {
      sensorTau: { id: 'p2-taus', text: (v) => (v === 0 ? '0 (ideal)' : `${v.toFixed(2)} s`) },
      K:    { id: 'p2-K',    text: (v) => v.toFixed(1) },
      tau:  { id: 'p2-tau',  text: (v) => `${v.toFixed(1)} s` },
      zeta: { id: 'p2-zeta', text: (v) => v.toFixed(2) },
      wn:   { id: 'p2-wn',   text: (v) => `${v.toFixed(1)} rad/s` },
      Kp:   { id: 'p2-kp',   text: (v) => v.toFixed(1) },
      Ki:   { id: 'p2-ki',   text: (v) => `${v.toFixed(1)} s⁻¹` },
      Kd:   { id: 'p2-kd',   text: (v) => `${v.toFixed(2)} s` },
      r:    { id: 'p2-r',    text: (v) => v.toFixed(1) },
      uMax: { id: 'p2-umax', text: (v) => fmt(v, 1) },
      uMin: { id: 'p2-umin', text: (v) => fmt(v, 1) }
    };
    Object.values(SLIDERS).forEach((s) => { s.el = $(s.id); s.out = $(s.id + '-value'); });

    const ui = {
      plantRadios: document.querySelectorAll('input[name="p2-plant"]'),
      dModeRadios: document.querySelectorAll('input[name="p2-dmode"]'),
      plantFirst: document.querySelectorAll('#p2-controls [data-plant="first"]'),
      plantSecond: document.querySelectorAll('#p2-controls [data-plant="second"]'),
      presets: document.querySelectorAll('[data-preset]'), presetHelp: $('p2-preset-help'),
      demos: document.querySelectorAll('[data-demo]'),
      window: $('p2-window'), reset: $('p2-reset'), inputError: $('p2-input-error'),
      bd: $('p2-bd'), paramChip: $('p2-param-chip'),
      yLegend: $('p2-y-legend'), yCanvas: $('p2-y-chart'),
      uLegend: $('p2-u-legend'), uCanvas: $('p2-u-chart'), satChip: $('p2-sat-chip'), uNote: $('p2-u-note'),
      sweepLegend: $('p2-sweep-legend'), sweepCanvas: $('p2-sweep-chart'), sweepChip: $('p2-sweep-chip'),
      pin: $('p2-pin'), unpin: $('p2-unpin'), refStatus: $('p2-ref-status'),
      status: $('p2-status'), satCallout: $('p2-sat-callout'), satText: $('p2-sat-text'),
      validationBody: $('p2-validation-body'), validationSummary: $('p2-validation-summary')
    };

    let yChart = null, uChart = null, sweepChart = null;
    let yGuides = null, uGuides = null, sweepGuides = null;
    let refCache = { key: '', result: null, metrics: null };
    let sweep = { key: '', points: [], limit: null, timer: 0 };
    let liveOvershoot = null;   // overshoot of y for the current τs (from the main run)

    /* ---------- Predict, then check ---------- */
    const QUESTIONS = [
      {
        setup: Object.assign({}, DEMO, { sensorTau: 0.01 }),
        prompt: 'PI loop (K = 1, τ = 1 s, Kp = 3, Ki = 10) with a fast sensor, τs = 0.01 s: the output overshoots by about 16%. The sensor is replaced by a slower one, τs = 0.3 s; the gains stay the same. What happens to the overshoot of the true output y?',
        choices: [
          { text: 'It grows a lot, to roughly 85–90%.', correct: true },
          { text: 'It stays about the same; the sensor only adds a small delay.', correct: false },
          { text: 'It shrinks, because a slow sensor smooths the response.', correct: false }
        ],
        explanation: 'The controller acts on m, which lags y by roughly τs. When y reaches the setpoint, m is still low, so e = r − m still looks large and the integral is still growing. The controller keeps pushing after it should have stopped, and y overshoots by about 87%.',
        tryIt: 'The fast-sensor loop is pinned as the grey reference. Drag τs to 0.3 s and compare the teal curve with it, then watch the sweep chart: the dot moves up the overshoot curve.'
      },
      {
        setup: Object.assign({}, DEMO, { sensorTau: 0.3 }),
        prompt: 'Same PI loop with τs = 0.3 s. Compare the true output y(t) with the sensor reading m(t). Which statement is true?',
        choices: [
          { text: 'm peaks later and lower than y: the sensor under-reports the overshoot.', correct: true },
          { text: 'm and y peak at the same moment with the same height.', correct: false },
          { text: 'm peaks higher than y, because the sensor exaggerates changes.', correct: false }
        ],
        explanation: 'The sensor is a first-order low-pass filter: it delays and smooths whatever y does. Here y overshoots by about 87% while m shows about 60%, and m peaks about 0.27 s later. A log of the sensor alone would make the loop look better behaved than it is.',
        tryIt: 'Read the two overshoot cards and the “sensor lag at the peak” readout. Then try τs = 0.5 s: the gap between y and m widens.'
      },
      {
        setup: Object.assign({}, DEMO, { sensorTau: 0.8 }),
        prompt: 'With τs = 0.8 s the same PI loop oscillates and never settles. Which single change makes it stable again?',
        choices: [
          { text: 'A faster sensor: τs below about 0.67 s (or a smaller Ki).', correct: true },
          { text: 'A larger Ki, so the error is removed faster.', correct: false },
          { text: 'A larger setpoint step.', correct: false }
        ],
        explanation: 'The loop is third order: τ·τs s³ + (τ + τs)s² + (1 + KKp)s + KKi = 0. Routh–Hurwitz says it is stable only while (τ + τs)(1 + KKp) > τ·τs·KKi, which here means τs < 4/6 = 0.67 s. A larger Ki makes the condition harder to meet; the setpoint size does not enter it at all.',
        tryIt: 'The oscillating loop is pinned. Drag τs below 0.67 s and watch the oscillation decay; or keep τs = 0.8 s and lower Ki to about 6.'
      }
    ];

    /* ---------- Configuration ---------- */
    function plantConfig(s) {
      return s.plant === 'first' ? { type: 'first', K: s.K, tau: s.tau } : { type: 'second', K: s.K, zeta: s.zeta, wn: s.wn };
    }
    function loopConfig(s, sensorTau = s.sensorTau) {
      return { plant: plantConfig(s), sensorTau, Kp: s.Kp, Ki: s.Ki, Kd: s.Kd, dMode: s.dMode, r: s.r, uMin: s.uMin, uMax: s.uMax };
    }
    function fmtGain(v) { return String(Number(v.toFixed(2))); }
    function gainsText(s) { return `Kp ${fmtGain(s.Kp)} · Ki ${fmtGain(s.Ki)} · Kd ${fmtGain(s.Kd)}`; }
    function tausText(v) { return v === 0 ? 'τs = 0 (ideal)' : `τs = ${fmt(v, 2)} s`; }

    /** Smallest τ_s that makes the linear loop unstable (scan, then bisection), or null if none up to 10 s. */
    function stabilityLimit(s) {
      const stableAt = (ts) => PidEngine.analyse(loopConfig(s, ts)).stable;
      if (!stableAt(0)) return { atZero: true, value: 0 };
      let prev = 0;
      for (let i = 0; i <= 160; i++) {
        const ts = 0.001 * Math.pow(10, (4 * i) / 160);   // 0.001 s … 10 s, logarithmic
        if (!stableAt(ts)) {
          let lo = prev, hi = ts;
          for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (stableAt(mid)) lo = mid; else hi = mid; }
          return { atZero: false, value: lo };
        }
        prev = ts;
      }
      return null;
    }

    /* ---------- Charts ---------- */
    function baseOptions() {
      return {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 6, hoverBorderWidth: 2 } },
        layout: { padding: { top: 6, right: 10 } }
      };
    }
    function lineSet(role, label, color, extra) {
      return Object.assign({ role, label, data: [], borderColor: color, backgroundColor: color,
        pointHoverBackgroundColor: '#fff', borderWidth: 2, tension: 0 }, extra);
    }
    function yScale(title) {
      return { title: { display: true, text: title, font: { weight: '600' } }, grid: { color: THEME.grid }, border: { color: THEME.axis } };
    }

    function createCharts() {
      if (!CHARTS_AVAILABLE) {
        document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = false; });
        return;
      }
      applyChartDefaults();
      const tooltip = () => Object.assign(tooltipStyle(), {
        callbacks: {
          title: (items) => (items.length ? `t = ${fmt(items[0].parsed.x, 3)} s` : ''),
          label: (item) => ` ${item.dataset.label}: ${fmt(item.parsed.y, 3)}`
        }
      });
      yChart = new Chart(ui.yCanvas, {
        type: 'line',
        data: { datasets: [
          lineSet('setpoint', 'Setpoint r(t)', THEME.setpoint, { borderWidth: 1.75, borderDash: [6, 5], order: 3 }),
          lineSet('y', 'True output y(t)', THEME.output, { borderWidth: 2.75, order: 0 }),
          lineSet('m', 'Sensor reading m(t)', THEME.sensor, { borderWidth: 2.5, borderDash: [8, 4], order: 1 }),
          lineSet('reference', 'Reference y(t)', THEME.reference, { borderDash: [2, 3], order: 4, hidden: true })
        ] },
        options: Object.assign(baseOptions(), {
          scales: { x: ControlKit.timeAxis(), y: yScale('Output y(t), reading m(t)') },
          plugins: { legend: { display: false }, tooltip: tooltip() }
        }),
        plugins: [createGuidesPlugin(() => yGuides)]
      });
      uChart = new Chart(ui.uCanvas, {
        type: 'line',
        data: { datasets: [lineSet('u', 'Control u(t)', THEME.control, { borderWidth: 2.5 })] },
        options: Object.assign(baseOptions(), {
          scales: { x: ControlKit.timeAxis(), y: yScale('Control u(t)') },
          plugins: { legend: { display: false }, tooltip: tooltip() }
        }),
        plugins: [createGuidesPlugin(() => uGuides)]
      });
      sweepChart = new Chart(ui.sweepCanvas, {
        type: 'line',
        data: { datasets: [
          lineSet('mpy', 'Overshoot of y', THEME.output, { borderWidth: 2.5, pointRadius: 3, spanGaps: false }),
          lineSet('mpm', 'Overshoot shown by m', THEME.sensor, { borderWidth: 2, borderDash: [8, 4], pointRadius: 2.5, spanGaps: false })
        ] },
        options: Object.assign(baseOptions(), {
          interaction: { mode: 'nearest', axis: 'x', intersect: false },
          scales: {
            x: { type: 'linear', min: 0, max: 1, title: { display: true, text: 'Sensor time constant τs (s)', font: { weight: '600' } },
                 grid: { color: THEME.grid }, border: { color: THEME.axis }, ticks: { maxRotation: 0 } },
            y: Object.assign(yScale('Overshoot (%)'), { beginAtZero: true })
          },
          plugins: { legend: { display: false }, tooltip: Object.assign(tooltipStyle(), {
            callbacks: {
              title: (items) => (items.length ? `τs = ${fmt(items[0].parsed.x, 3)} s` : ''),
              label: (item) => ` ${item.dataset.label}: ${fmt(item.parsed.y, 1)}%`
            }
          }) }
        }),
        plugins: [createGuidesPlugin(() => sweepGuides)]
      });
    }

    /* ---------- Simulation ---------- */
    function runLoop(s) {
      const cfg = loopConfig(s);
      let result = PidEngine.simulate(cfg);
      let met = PidEngine.metrics(result, 'y');
      let window = s.window === 'auto' ? ControlKit.autoWindow(result, met) : Number(s.window);
      if (window > result.horizon + 1e-9 && !result.diverged) {
        result = PidEngine.simulate(cfg, { horizon: window });
        met = PidEngine.metrics(result, 'y');
        if (s.window === 'auto') window = ControlKit.autoWindow(result, met);
      }
      return { result, met, metM: PidEngine.metrics(result, 'm'), window: Math.min(window, result.horizon) || window };
    }

    function referenceRun(W) {
      const ref = state.reference;
      if (!ref) return null;
      const key = JSON.stringify(ref) + '|' + W;
      if (refCache.key !== key) {
        const result = PidEngine.simulate(loopConfig(ref), { minHorizon: W });
        refCache = { key, result, metrics: PidEngine.metrics(result, 'y') };
      }
      return refCache;
    }

    /* ---------- Render ---------- */
    function render() {
      let run;
      try {
        run = runLoop(state);
        ui.inputError.hidden = true;
      } catch (error) {
        ui.inputError.textContent = error.message;
        ui.inputError.hidden = false;
        return;
      }
      const { result, met, metM } = run;
      const W = run.window;
      const rec = result.rec;
      const r = state.r;
      const ok = met.status === 'ok';
      const ref = referenceRun(W);

      // Diagram and chips
      ControlKit.setDiagramText(ui.bd, 'gains', gainsText(state));
      ControlKit.setDiagramText(ui.bd, 'limits', `limits ${fmt(state.uMin, 1)} … ${fmt(state.uMax, 1)}`);
      ControlKit.setDiagramText(ui.bd, 'plant-name', state.plant === 'first' ? 'First-order plant' : 'Second-order plant');
      ControlKit.setDiagramText(ui.bd, 'plant-tf', state.plant === 'first'
        ? `G(s) = ${fmtGain(state.K)} / (${fmtGain(state.tau)}s + 1)`
        : `G(s) = ${fmtGain(state.K * state.wn * state.wn)} / (s² + ${fmtGain(2 * state.zeta * state.wn)}s + ${fmtGain(state.wn * state.wn)})`);
      ControlKit.setDiagramText(ui.bd, 'sensor-tf', state.sensorTau === 0 ? '1 (ideal, m = y)' : `1 / (${fmtGain(state.sensorTau)}s + 1)`);
      ui.paramChip.textContent = `${tausText(state.sensorTau)}, ${gainsText(state)}`;

      // Response chart: r, y and m
      const [ylo, yhi] = ControlKit.extent(rec, 'y', W);
      const [mlo, mhi] = ControlKit.extent(rec, 'm', W);
      const values = [0, r, ylo, yhi, mlo, mhi];
      if (ref) { const [a, b] = ControlKit.extent(ref.result.rec, 'y', W); values.push(a, b); }
      const clip = ok || met.status === 'not-settled' ? null : [-2 * Math.abs(r), 3 * Math.abs(r)];
      const yRange = ControlKit.valueRange(values, clip);
      const legend = [
        { label: 'Setpoint r(t)', kind: 'dashed', color: THEME.setpoint },
        { label: 'True output y(t)', kind: 'line', color: THEME.output },
        { label: 'Sensor reading m(t), what the controller sees', kind: 'dashed', color: THEME.sensor }
      ];
      if (ok && met.mp > 0.05) legend.push({ label: 'Peaks of y and m', kind: 'dot', color: THEME.error });
      if (ref) legend.push({ label: `Reference y(t): ${tausText(state.reference.sensorTau)}, ${gainsText(state.reference)}`, kind: 'dotted', color: THEME.reference });
      renderLegend(ui.yLegend, legend);
      if (yChart) {
        const [sp, ySet, mSet, refSet] = yChart.data.datasets;
        sp.data = [{ x: 0, y: r }, { x: W, y: r }];
        ySet.data = PidEngine.decimate(rec, 'y', 0, W, 500);
        mSet.data = PidEngine.decimate(rec, 'm', 0, W, 500);
        refSet.hidden = !ref;
        refSet.data = ref ? PidEngine.decimate(ref.result.rec, 'y', 0, W, 400) : [];
        yChart.options.scales.x.max = W;
        yChart.options.scales.y.min = yRange[0];
        yChart.options.scales.y.max = yRange[1];
        yGuides = { lines: [], markers: [], labels: [] };
        if (ok) {
          const band = PidEngine.SETTLE_BAND * Math.abs(met.yss);
          const c = hexToRgba(THEME.output, 0.45);
          yGuides.lines.push({ x1: 0, y1: met.yss + band, x2: W, y2: met.yss + band, color: c, dash: [4, 4] });
          yGuides.lines.push({ x1: 0, y1: met.yss - band, x2: W, y2: met.yss - band, color: c, dash: [4, 4] });
          if (met.mp > 0.05 && met.tPeak <= W) {
            yGuides.markers.push({ x: met.tPeak, y: met.yPeak, color: THEME.output });
            yGuides.labels.push({ x: met.tPeak, y: met.yPeak, dx: 10, dy: -12, text: `y peaks: +${fmt(met.mp, 1)}%`, short: `y +${fmt(met.mp, 0)}%`, color: THEME.output });
          }
          if (metM.status === 'ok' && metM.mp > 0.05 && metM.tPeak <= W) {
            yGuides.markers.push({ x: metM.tPeak, y: metM.yPeak, color: THEME.sensor });
            yGuides.labels.push({ x: metM.tPeak, y: metM.yPeak, dx: 10, dy: 14, text: `m shows: +${fmt(metM.mp, 1)}%`, short: `m +${fmt(metM.mp, 0)}%`, color: THEME.sensor });
          }
        }
        yChart.update('none');
      }

      // Control signal
      const uVals = ControlKit.extent(rec, 'u', W).concat([0]);
      const span = Math.max(Math.max(...uVals) - Math.min(...uVals), 1e-6);
      const showMax = state.uMax <= Math.max(...uVals) + 1.5 * span;
      const showMin = state.uMin >= Math.min(...uVals) - 1.5 * span;
      if (showMax) uVals.push(state.uMax);
      if (showMin) uVals.push(state.uMin);
      const uRange = ControlKit.valueRange(uVals);
      renderLegend(ui.uLegend, [{ label: 'Control signal u(t) (after the limit)', kind: 'line', color: THEME.control },
                                { label: 'Limits u_min, u_max', kind: 'dashed', color: THEME.limit }]);
      if (uChart) {
        uChart.data.datasets[0].data = PidEngine.decimate(rec, 'u', 0, W, 500);
        uChart.options.scales.x.max = W;
        uChart.options.scales.y.min = uRange[0];
        uChart.options.scales.y.max = uRange[1];
        const lc = hexToRgba(THEME.limit, 0.85);
        uGuides = { spans: ControlKit.saturationSpans(rec, W), lines: [], labels: [] };
        if (showMax) {
          uGuides.lines.push({ x1: 0, y1: state.uMax, x2: W, y2: state.uMax, color: lc, dash: [6, 4], width: 1.5 });
          uGuides.labels.push({ x: W, y: state.uMax, dx: -4, dy: -12, align: 'right', text: `u_max = ${fmt(state.uMax, 1)}`, color: THEME.limit });
        }
        if (showMin) {
          uGuides.lines.push({ x1: 0, y1: state.uMin, x2: W, y2: state.uMin, color: lc, dash: [6, 4], width: 1.5 });
          uGuides.labels.push({ x: W, y: state.uMin, dx: -4, dy: 12, align: 'right', text: `u_min = ${fmt(state.uMin, 1)}`, color: THEME.limit });
        }
        uChart.update('none');
      }
      const hidden = [!showMax && `u_max = ${fmt(state.uMax, 1)}`, !showMin && `u_min = ${fmt(state.uMin, 1)}`].filter(Boolean);
      ui.uNote.textContent = hidden.length ? `${hidden.join(' and ')} ${hidden.length > 1 ? 'are' : 'is'} far outside this view, so not drawn. Red shading marks saturation.` : 'Red shading marks the time u spends at a limit.';
      ui.satChip.textContent = met.satTime > 0 ? `Saturated for ${fmt(met.satTime, 3)} s` : 'Not saturated';
      ui.satChip.className = 'chip ' + (met.satTime > 0 ? 'chip--fail' : 'chip--pass');

      // Status and metrics
      const bad = ControlKit.statusSentence(met);
      if (!bad) {
        ui.status.className = 'status-line status-line--ok';
        ui.status.innerHTML = `<strong>Stable and settled.</strong><span>y and m both end at ${escapeHtml(fmt(met.yss, 4))}; y stays within ±2% after t = ${escapeHtml(fmt(met.ts, 3))} s.</span>`;
      } else {
        ui.status.className = 'status-line status-line--' + bad.cls;
        ui.status.innerHTML = `<strong>${escapeHtml(bad.title)}</strong><span>${escapeHtml(bad.text)}</span>`;
      }
      const set = (id, text, na) => { const el = $(id); el.textContent = text; el.parentElement.classList.toggle('is-na', na); };
      set('p2-m-mpy', ControlKit.metricText(met.mp, 1), !ok);
      set('p2-m-mpm', ControlKit.metricText(metM.status === 'ok' ? metM.mp : NaN, 1), metM.status !== 'ok');
      set('p2-m-tr', ControlKit.metricText(met.tr, 3), !ok);
      set('p2-m-ts', ControlKit.metricText(met.ts, 3), !ok);
      set('p2-m-ess', ControlKit.metricText(met.ess, 3), !ok);
      $('p2-m-ess-pct').textContent = ok ? `(${fmt(met.essPct, 1)}%)` : '';
      $('p2-m-mpm-note').textContent = ok && metM.status === 'ok'
        ? (met.mp - metM.mp > 0.5 ? `The sensor hides ${fmt(met.mp - metM.mp, 1)} points of overshoot.` : 'Close to the true overshoot: the sensor is fast enough.')
        : 'Peak of m(t).';
      $('p2-m-lag').textContent = ok && metM.status === 'ok' && met.mp > 0.05 && metM.mp > 0.05
        ? `${fmt(metM.tPeak - met.tPeak, 3)} s` : '—';
      const lim = stabilityLimit(state);
      $('p2-m-limit').textContent = !lim ? 'none up to τs = 10 s'
        : lim.atZero ? 'unstable even at τs = 0' : `τs < ${fmt(lim.value, 3)} s`;
      $('p2-m-poles').textContent = `${ControlKit.polesText(result.analysis.poles)}  →  ${result.analysis.stable ? 'stable' : 'unstable'}`;
      const refMet = ref ? ref.metrics : null;
      const refLine = (id, key, dec, unit) => {
        $(id).innerHTML = refMet ? `Pinned: <b>${refMet.status === 'ok' ? escapeHtml(fmt(refMet[key], dec)) + unit : '—'}</b>` : '';
      };
      refLine('p2-r-mpy', 'mp', 1, '%');
      refLine('p2-r-tr', 'tr', 3, ' s');
      refLine('p2-r-ts', 'ts', 3, ' s');

      if (met.satTime > 0) {
        ui.satCallout.hidden = false;
        ui.satText.textContent = met.status === 'ok'
          ? `u was held at a limit for ${fmt(met.satTime, 3)} s, so the plant received less than the PID asked for. The closed-loop poles and the stability limit above describe the unsaturated loop.`
          : `u hit a limit for ${fmt(met.satTime, 3)} s. The linear loop is unstable, so the swings grow until the actuator limits stop them: the limits bound the oscillation, they do not remove it.`;
      } else {
        ui.satCallout.hidden = true;
      }

      // Reference controls
      const same = state.reference && JSON.stringify(loopConfig(state.reference)) === JSON.stringify(loopConfig(state));
      ui.refStatus.textContent = !state.reference
        ? 'No reference curve. Pin the current y(t), then change τs to compare.'
        : same ? 'Reference pinned (identical to the live curve). Change τs or a gain to compare.'
          : `Grey dotted reference: y(t) with ${tausText(state.reference.sensorTau)}, ${gainsText(state.reference)}.`;
      ui.pin.disabled = Boolean(same);
      ui.unpin.disabled = !state.reference;

      ui.yCanvas.setAttribute('aria-label', ok
        ? `With ${tausText(state.sensorTau)} the true output overshoots by ${fmt(met.mp, 1)} percent while the sensor shows ${fmt(metM.mp, 1)} percent; settling time ${fmt(met.ts, 2)} s.`
        : `With ${tausText(state.sensorTau)}: ${met.reason}`);

      liveOvershoot = ok ? met.mp : null;
      scheduleSweep(lim);
      drawSweep();
    }

    /* ---------- Overshoot vs τs sweep (recomputed only when the plant or gains change) ---------- */
    function sweepKey() {
      const c = loopConfig(state, 0);
      return JSON.stringify(c);
    }
    function scheduleSweep(lim) {
      const key = sweepKey();
      if (key === sweep.key) return;
      clearTimeout(sweep.timer);
      const tMax = lim && !lim.atZero ? Math.min(3, Math.max(0.1, ControlKit.niceCeil(2 * lim.value))) : 1.5;
      sweep = { key, points: [], limit: lim, tMax, timer: 0, done: false };
      ui.sweepChip.textContent = 'Computing…';
      ui.sweepChip.className = 'chip';
      const s = Object.assign({}, state);
      let i = 0;
      const step = () => {
        if (sweep.key !== key) return;                       // the gains changed again: abandon this sweep
        const t0 = performance.now();
        while (i < SWEEP_POINTS && performance.now() - t0 < 30) {
          const ts = (tMax * i) / (SWEEP_POINTS - 1);
          const res = PidEngine.simulate(loopConfig(s, ts));
          const my = PidEngine.metrics(res, 'y');
          const mm = PidEngine.metrics(res, 'm');
          sweep.points.push({ ts, mpy: my.status === 'ok' ? my.mp : null, mpm: mm.status === 'ok' ? mm.mp : null, stable: res.analysis.stable });
          i++;
        }
        drawSweep();
        if (i < SWEEP_POINTS) sweep.timer = setTimeout(step, 0);
        else {
          sweep.done = true;
          const unstable = sweep.points.filter((p) => !p.stable).length;
          ui.sweepChip.textContent = unstable ? `${unstable} of ${SWEEP_POINTS} unstable` : 'Stable over this range';
          ui.sweepChip.className = 'chip ' + (unstable ? 'chip--fail' : 'chip--pass');
          drawSweep();
        }
      };
      sweep.timer = setTimeout(step, 120);                    // wait until slider dragging pauses
    }

    function drawSweep() {
      const legend = [
        { label: 'Overshoot of true y', kind: 'line', color: THEME.output },
        { label: 'Overshoot shown by m', kind: 'dashed', color: THEME.sensor },
        { label: 'Current τs', kind: 'dot', color: THEME.tau3 }
      ];
      if (sweep.limit && !sweep.limit.atZero && sweep.limit.value <= sweep.tMax) legend.push({ label: `Unstable for τs > ${fmt(sweep.limit.value, 3)} s`, kind: 'hbar', color: THEME.limit });
      renderLegend(ui.sweepLegend, legend);
      if (!sweepChart) return;
      const [a, b] = sweepChart.data.datasets;
      a.data = sweep.points.map((p) => ({ x: p.ts, y: p.mpy }));
      b.data = sweep.points.map((p) => ({ x: p.ts, y: p.mpm }));
      sweepChart.options.scales.x.max = sweep.tMax;
      const ys = sweep.points.flatMap((p) => [p.mpy, p.mpm]).filter((v) => v !== null);
      const top = Math.max(10, ...ys);
      sweepChart.options.scales.y.max = ControlKit.niceCeil(1.1 * top);
      sweepGuides = { spans: [], lines: [], markers: [], labels: [] };
      const lim = sweep.limit;
      if (lim && (lim.atZero || lim.value < sweep.tMax)) {
        sweepGuides.spans.push({ x1: lim.atZero ? 0 : lim.value, x2: sweep.tMax, color: 'rgba(185, 28, 28, 0.10)' });
        if (!lim.atZero) {
          sweepGuides.lines.push({ x1: lim.value, y1: 0, x2: lim.value, y2: sweepChart.options.scales.y.max, color: THEME.limit, dash: [5, 4], width: 1.5 });
          sweepGuides.labels.push({ x: lim.value, y: sweepChart.options.scales.y.max, dx: 6, dy: 14, text: `stability limit ${fmt(lim.value, 3)} s`, short: `limit ${fmt(lim.value, 2)} s`, color: THEME.limit });
        }
      }
      // Current τs: read its overshoot from the live run so the dot sits on the curve.
      if (state.sensorTau <= sweep.tMax) {
        const yv = liveOvershoot === null ? 0 : liveOvershoot;
        sweepGuides.lines.push({ x1: state.sensorTau, y1: 0, x2: state.sensorTau, y2: sweepChart.options.scales.y.max, color: hexToRgba(THEME.tau3, 0.5), dash: [2, 3] });
        sweepGuides.markers.push({ x: state.sensorTau, y: yv, color: THEME.tau3 });
        sweepGuides.labels.push({ x: state.sensorTau, y: yv, dx: 10, dy: -12,
          text: liveOvershoot !== null ? `now: ${fmt(yv, 1)}%` : 'now: does not settle', color: THEME.tau3 });
      }
      sweepChart.update('none');
    }

    /* ---------- Validation ---------- */
    function runValidation() {
      const base = Object.assign({}, DEMO);
      const checks = [];
      const e = (v) => (Math.abs(v) < 1e-12 ? '< 1e−12' : v.toExponential(1).replace('-', '−'));

      // 1. The controller error really is r − m.
      const demo = PidEngine.simulate(loopConfig(base, 0.3), { horizon: 10 });
      let dm = 0, dy = 0;
      demo.rec.t.forEach((t, i) => {
        dm = Math.max(dm, Math.abs(demo.rec.e[i] - (1 - demo.rec.m[i])));
        dy = Math.max(dy, Math.abs(demo.rec.e[i] - (1 - demo.rec.y[i])));
      });
      checks.push({
        name: 'Feedback uses the sensor reading',
        detail: 'Demonstration loop with τs = 0.3 s, every recorded sample',
        expected: { main: 'e(t) = r − m(t)', sub: 'and e(t) ≠ r − y(t)' },
        calculated: { main: `max |e − (r − m)| = ${e(dm)}`, sub: `max |e − (r − y)| = ${fmt(dy, 3)}` },
        pass: dm <= 1e-12 && dy > 0.05
      });

      // 2. τs = 0 is the ideal sensor and reproduces P1's test 1.
      const ideal = PidEngine.simulate({ plant: { type: 'first', K: 1, tau: 1 }, sensorTau: 0, Kp: 9, r: 1, uMin: -10, uMax: 10 }, { horizon: 3 });
      const mi = PidEngine.metrics(ideal);
      let tauCl = NaN, same = 0;
      const lvl = (1 - Math.exp(-1)) * mi.yss;
      for (let i = 1; i < ideal.rec.y.length; i++) {
        same = Math.max(same, Math.abs(ideal.rec.m[i] - ideal.rec.y[i]));
        if (Number.isNaN(tauCl) && ideal.rec.y[i] >= lvl) {
          const a = ideal.rec.y[i - 1], b = ideal.rec.y[i];
          tauCl = ideal.rec.t[i - 1] + ((lvl - a) / (b - a)) * (ideal.rec.t[i] - ideal.rec.t[i - 1]);
        }
      }
      checks.push({
        name: 'τs = 0: ideal sensor, same as P1 test 1',
        detail: 'P only, Kp = 9; no division by τs = 0',
        expected: { main: 'm = y, τ_cl = 0.100 s, e_ss = 0.100', sub: 'τ/(1 + KKp), 1/(1 + KKp)' },
        calculated: { main: `τ_cl = ${fmt(tauCl, 4)} s, e_ss = ${fmt(mi.ess, 4)}`, sub: `max |m − y| = ${e(same)}` },
        pass: same === 0 && Math.abs(tauCl - 0.1) <= 0.001 && Math.abs(mi.ess - 0.1) <= 0.001
      });

      // 3. Steady state: a unity-gain sensor and PI give y = m = r.
      const slow = PidEngine.simulate(loopConfig(base, 0.3), { horizon: 40 });   // ≈ 5 × t_s, so it has converged
      const md = PidEngine.metrics(slow, 'y');
      const mm = PidEngine.metrics(slow, 'm');
      checks.push({
        name: 'Steady state with a slow sensor (PI, τs = 0.3 s)',
        detail: 'Sensor DC gain is 1, and the integral drives e = r − m to zero',
        expected: { main: 'y_final = m_final = 1', sub: '|error| ≤ 1e−3' },
        calculated: { main: `y = ${fmt(md.yss, 4)}, m = ${fmt(mm.yss, 4)}`, sub: `after ${fmt(slow.horizon, 0)} s` },
        pass: md.status === 'ok' && mm.status === 'ok' && Math.abs(md.yss - 1) <= 1e-3 && Math.abs(mm.yss - 1) <= 1e-3
      });

      // 4. Stability limit: Routh–Hurwitz vs closed-loop poles vs simulation.
      const tau = 1, K = 1, Kp = base.Kp, Ki = base.Ki;
      const routh = (tau * (1 + K * Kp)) / (tau * K * Ki - (1 + K * Kp));
      const fromPoles = stabilityLimit(base).value;
      checks.push({
        name: 'Stability limit on τs (Kp = 3, Ki = 10)',
        detail: 'Routh–Hurwitz on τ·τs s³ + (τ + τs)s² + (1 + KKp)s + KKi',
        expected: { main: `τs,max = ${fmt(routh, 4)} s`, sub: 'τ(1 + KKp) / (τKKi − (1 + KKp)) = 4/6' },
        calculated: { main: `${fmt(fromPoles, 4)} s`, sub: 'where a closed-loop pole crosses into Re s > 0' },
        pass: Math.abs(fromPoles - routh) <= 1e-3
      });
      const swing = (ts) => {
        const res = PidEngine.simulate(Object.assign(loopConfig(base, ts), { uMin: -Infinity, uMax: Infinity }), { horizon: 60 });
        const amp = (t0, t1) => {
          let a = 0;
          res.rec.t.forEach((t, i) => { if (t >= t0 && t < t1) a = Math.max(a, Math.abs(res.rec.y[i] - 1)); });
          return a;
        };
        return amp(40, 60) / amp(20, 40);                    // < 1 decaying, > 1 growing
      };
      const below = swing(0.9 * routh), above = swing(1.1 * routh);
      checks.push({
        name: 'Simulation agrees with the limit',
        detail: 'Swing of y over 40–60 s divided by the swing over 20–40 s (no limits)',
        expected: { main: '< 1 at 0.9·τs,max; > 1 at 1.1·τs,max', sub: 'decaying vs growing oscillation' },
        calculated: { main: `${fmt(below, 3)} and ${fmt(above, 3)}`, sub: `τs = ${fmt(0.9 * routh, 3)} s and ${fmt(1.1 * routh, 3)} s` },
        pass: below < 1 && above > 1
      });

      // 5. The demonstration: overshoot grows with τs.
      const mps = [0.01, 0.1, 0.3].map((ts) => PidEngine.metrics(PidEngine.simulate(loopConfig(base, ts))).mp);
      checks.push({
        name: 'Overshoot grows as the sensor slows',
        detail: 'Demonstration loop, τs = 0.01, 0.1, 0.3 s',
        expected: { main: 'M_p increasing', sub: 'about 16%, 32%, 87%' },
        calculated: { main: mps.map((v) => `${fmt(v, 1)}%`).join(' → '), sub: 'overshoot of the true output y' },
        pass: mps[0] < mps[1] && mps[1] < mps[2]
      });

      const passed = renderValidation(ui.validationBody, checks);
      ui.validationSummary.textContent = `${passed} of ${checks.length} passed`;
      ui.validationSummary.className = 'chip ' + (passed === checks.length ? 'chip--pass' : 'chip--fail');
    }

    /* ---------- Controls ---------- */
    function syncControls() {
      Object.entries(SLIDERS).forEach(([key, s]) => {
        s.el.value = String(state[key]);
        s.out.textContent = s.text(state[key]);
        s.el.setAttribute('aria-valuetext', s.text(state[key]));
        ControlKit.setSliderFill(s.el);
      });
      ui.plantRadios.forEach((radio) => { radio.checked = radio.value === state.plant; });
      ui.dModeRadios.forEach((radio) => { radio.checked = radio.value === state.dMode; });
      ui.plantFirst.forEach((el) => { el.hidden = state.plant !== 'first'; });
      ui.plantSecond.forEach((el) => { el.hidden = state.plant !== 'second'; });
      ui.window.value = state.window;
      ui.presetHelp.textContent = PRESET_HELP[state.plant];
      const presets = PRESETS[state.plant];
      ui.presets.forEach((btn) => {
        const p = presets[btn.dataset.preset];
        btn.setAttribute('aria-pressed', String(p.Kp === state.Kp && p.Ki === state.Ki && p.Kd === state.Kd));
      });
      const isDemo = Object.keys(DEMO).every((k) => state[k] === DEMO[k]);
      ui.demos.forEach((btn) => btn.setAttribute('aria-pressed', String(isDemo && Number(btn.dataset.demo) === state.sensorTau)));
    }

    const scheduleRender = ControlKit.frameThrottle(render);
    function onControlChange() {
      syncControls();
      scheduleRender();
      predict.notifyInteraction();
    }

    Object.entries(SLIDERS).forEach(([key, s]) => {
      s.el.addEventListener('input', () => { state[key] = Number(s.el.value); onControlChange(); });
    });
    ui.plantRadios.forEach((radio) => radio.addEventListener('change', () => {
      if (radio.checked) { state.plant = radio.value; Object.assign(state, PRESETS[state.plant].PI); onControlChange(); }
    }));
    ui.dModeRadios.forEach((radio) => radio.addEventListener('change', () => {
      if (radio.checked) { state.dMode = radio.value; onControlChange(); }
    }));
    ui.presets.forEach((btn) => btn.addEventListener('click', () => {
      Object.assign(state, PRESETS[state.plant][btn.dataset.preset]);
      onControlChange();
    }));
    ui.demos.forEach((btn) => btn.addEventListener('click', () => {
      Object.assign(state, DEMO, { sensorTau: Number(btn.dataset.demo) });
      onControlChange();
    }));
    ui.window.addEventListener('change', () => { state.window = ui.window.value; onControlChange(); });
    ui.reset.addEventListener('click', () => {
      Object.assign(state, DEFAULTS, { reference: null });
      syncControls();
      render();
    });

    function snapshot() {
      const keys = ['plant', 'K', 'tau', 'zeta', 'wn', 'sensorTau', 'Kp', 'Ki', 'Kd', 'dMode', 'r', 'uMax', 'uMin'];
      return Object.fromEntries(keys.map((k) => [k, state[k]]));
    }
    function pinCurrent() { state.reference = snapshot(); render(); }
    ui.pin.addEventListener('click', pinCurrent);
    ui.unpin.addEventListener('click', () => { state.reference = null; render(); });

    const predict = createPredictCheck($('p2-predict'), QUESTIONS, {
      onCheck: (q) => {
        Object.assign(state, q.setup, { window: 'auto' });
        syncControls();
        pinCurrent();
      }
    });

    createCharts();
    syncControls();
    render();
    runValidation();
  }

  /* =========================================================================
     START-UP
     ========================================================================= */
  initP2();
  