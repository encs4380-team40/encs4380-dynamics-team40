
  'use strict';

  /* =========================================================================
     1. SHARED TOOLKIT HELPERS
        Plain functions that Modules 2–4 can reuse: number formatting, chart
        theme, a small annotation plugin, legends, the validation table and
        the "Predict, then check" component.
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
    errorText: '#b45309'   // output error, text (darker for contrast)
  };

  /** True when the Chart.js script loaded from the CDN. */
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
     getGuides() returns { lines, segments, markers, labels } for the current state. */
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
     2. FIRST-ORDER SENSOR MATHEMATICS (pure functions, no page access)
        Model: τ dy/dt + y = K x(t),  G(s) = K / (τs + 1), zero initial conditions.
        Module 2 can add the frequency-response functions to this object.
     ========================================================================= */
  const FirstOrder = {
    /** Step input x(t) = A:  y(t) = KA(1 − e^(−t/τ)). */
    stepResponse(t, K, tau, A = 1) {
      return K * A * (1 - Math.exp(-t / tau));
    },

    /** Ramp input x(t) = At:  y(t) = KA[t − τ(1 − e^(−t/τ))]. */
    rampResponse(t, K, tau, A = 1) {
      return K * A * (t - tau * (1 - Math.exp(-t / tau)));
    },

    /** Ramp tracking error e(t) = Kx(t) − y(t) = KAτ(1 − e^(−t/τ)) → KAτ. */
    rampError(t, K, tau, A = 1) {
      return K * A * tau * (1 - Math.exp(-t / tau));
    },

    /** Step error fraction f(t) = (KA − y(t)) / KA = e^(−t/τ). Independent of K and A. */
    stepErrorFraction(t, tau) {
      return Math.exp(-t / tau);
    },

    /** 10 %–90 % rise time of a first-order step response: τ ln 9. */
    riseTime(tau) {
      return tau * Math.log(9);
    }
  };

  /* =========================================================================
     3. MODULE 1: FIRST-ORDER TIME RESPONSE (user interface)
     ========================================================================= */
  function initModule1() {
    const A = 1;                    // input amplitude, fixed (shown in the UI)
    const SAMPLES_PER_TAU = 20;     // Δt = τ/20, so t = τ is sample 20 and t = 3τ is sample 60 exactly
    const SPAN_IN_TAU = 6;          // the charts cover 0 … 6τ
    const RAMP_MARK_IN_TAU = 4;     // the ramp error and lag brackets are drawn at t = 4τ
    const LOG_AXIS_MIN = 1e-3;      // bottom of the logarithmic axis
    const DEFAULTS = Object.freeze({ K: 1.0, tau: 2.0, input: 'step' });

    // Current settings. The reference curve starts at the defaults and is
    // hidden while it is identical to the live curve.
    const state = {
      K: DEFAULTS.K,
      tau: DEFAULTS.tau,
      input: DEFAULTS.input,
      reference: { K: DEFAULTS.K, tau: DEFAULTS.tau }
    };

    const $ = (id) => document.getElementById(id);
    const ui = {
      kSlider: $('m1-k'), kValue: $('m1-k-value'),
      tauSlider: $('m1-tau'), tauValue: $('m1-tau-value'),
      inputRadios: document.querySelectorAll('input[name="m1-input"]'),
      inputHelp: $('m1-input-help'),
      reset: $('m1-reset'), pin: $('m1-pin'), unpin: $('m1-unpin'), refStatus: $('m1-ref-status'),
      chartTitle: $('m1-chart-title'), chartSub: $('m1-chart-sub'), paramChip: $('m1-param-chip'),
      eqStep: $('m1-eq-step'), eqRamp: $('m1-eq-ramp'),
      mainLegend: $('m1-main-legend'), mainCanvas: $('m1-main-chart'),
      metricsStep: $('m1-metrics-step'), metricsRamp: $('m1-metrics-ramp'),
      stepCallout: $('m1-step-callout'), rampCallout: $('m1-ramp-callout'), rampLive: $('m1-ramp-live'),
      logLegend: $('m1-log-legend'), logCanvas: $('m1-log-chart'), logRampNote: $('m1-log-ramp-note'),
      slopeChip: $('m1-slope-chip'), slopeTheory: $('m1-slope-theory'), slopeRead: $('m1-slope-read'),
      tauEstimate: $('m1-tau-estimate'),
      validationBody: $('m1-validation-body'), validationSummary: $('m1-validation-summary')
    };

    let mainChart = null;
    let logChart = null;
    let mainGuides = null;   // annotations for the main chart (read by the plugin)
    let logGuides = null;    // annotations for the log chart

    /* ---------- Predict, then check questions ---------- */
    const QUESTIONS = [
      {
        prompt: 'What happens when the time constant τ increases while K stays constant?',
        choices: [
          { text: 'The sensor responds faster.', correct: false },
          { text: 'The sensor responds more slowly.', correct: true },
          { text: 'The sensor’s final step-response value increases.', correct: false }
        ],
        explanation: 'A larger τ means the sensor must store more energy for the same rate of exchange (more heat capacity, or more capacitance), so it closes the gap to K·x more slowly. The 63.2% point, the 95% point and the rise time all grow in proportion to τ. The final value KA does not depend on τ at all.',
        tryIt: 'Your current curve is now pinned as the dotted reference. Drag the τ slider to a larger value: the reference now reaches its final value much earlier than the live curve.'
      },
      {
        prompt: 'You double the gain K and keep τ the same. What happens to the time needed to reach 63.2% of the final value?',
        choices: [
          { text: 'It halves.', correct: false },
          { text: 'It stays the same.', correct: true },
          { text: 'It doubles.', correct: false }
        ],
        explanation: 'K scales the whole response vertically, so the final value becomes 2KA, but the timing is set only by τ. The output still reaches 63.2% of its new, larger final value at exactly t = τ.',
        tryIt: 'Your current curve is pinned as the reference. Drag the K slider: the live curve grows taller or shorter, but its 63.2% marker stays on the t = τ gridline.'
      },
      {
        prompt: 'For a ramp input, what happens to the steady-state error if τ doubles (K and A unchanged)?',
        choices: [
          { text: 'It halves.', correct: false },
          { text: 'It does not change.', correct: false },
          { text: 'It doubles.', correct: true }
        ],
        explanation: 'The steady-state error is e_ss = KAτ: the output follows the ideal ramp τ seconds late, and the ramp rises KA every second, so the gap is KA × τ. Doubling τ doubles both the time lag and the error.',
        tryIt: 'Select Ramp input, then double τ and watch the steady-state error card double.'
      }
    ];

    /* ---------- Model helpers ---------- */

    /** Uniform time samples 0, Δt, 2Δt, …, 6τ with Δt = τ/20. */
    function timeGrid(tau) {
      const count = SAMPLES_PER_TAU * SPAN_IN_TAU;
      const dt = tau / SAMPLES_PER_TAU;
      return Array.from({ length: count + 1 }, (_, i) => i * dt);
    }

    /** Ideal gain-scaled input K·x(t). */
    function idealOutput(t, K, input) {
      return input === 'step' ? K * A : K * A * t;
    }

    /** Sensor output y(t) for the selected input type. */
    function sensorOutput(t, K, tau, input) {
      return input === 'step'
        ? FirstOrder.stepResponse(t, K, tau, A)
        : FirstOrder.rampResponse(t, K, tau, A);
    }

    /** The reference settings, or null when there is none or it matches the live curve. */
    function visibleReference() {
      const ref = state.reference;
      if (!ref) return null;
      const same = Math.abs(ref.K - state.K) < 1e-9 && Math.abs(ref.tau - state.tau) < 1e-9;
      return same ? null : ref;
    }

    function referenceText(ref) {
      return `K = ${ref.K.toFixed(1)}, τ = ${ref.tau.toFixed(1)} s`;
    }

    /* ---------- Charts ---------- */

    /** Tooltip title: time, plus "= nτ" on samples that sit exactly on a gridline. */
    function timeTitle(items) {
      if (!items.length) return '';
      const n = items[0].dataIndex / SAMPLES_PER_TAU;
      const note = Number.isInteger(n) && n > 0 ? `   (t = ${n === 1 ? '' : n}τ)` : '';
      return `t = ${fmt(items[0].parsed.x, 2)} s${note}`;
    }

    function createCharts() {
      if (!CHARTS_AVAILABLE) {
        document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = false; });
        return;
      }
      applyChartDefaults();
      const getTau = () => state.tau;
      const baseOptions = () => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,        // data is already { x, y }
        normalized: true,      // x values are sorted and unique
        interaction: { mode: 'index', intersect: false },
        elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 6, hoverBorderWidth: 2 } },
        layout: { padding: { top: 6, right: 10 } }
      });

      mainChart = new Chart(ui.mainCanvas, {
        type: 'line',
        data: {
          datasets: [
            { role: 'ideal', label: 'Ideal input K·x(t)', data: [], borderColor: THEME.ideal, backgroundColor: THEME.ideal,
              pointHoverBackgroundColor: '#fff', borderWidth: 1.75, borderDash: [6, 5], order: 1 },
            { role: 'output', label: 'Sensor output y(t)', data: [], borderColor: THEME.output, backgroundColor: THEME.output,
              pointHoverBackgroundColor: '#fff', borderWidth: 2.75, order: 0 },
            { role: 'reference', label: 'Reference', data: [], borderColor: THEME.reference, backgroundColor: THEME.reference,
              pointHoverBackgroundColor: '#fff', borderWidth: 2, borderDash: [2, 3], order: 2, hidden: true }
          ]
        },
        options: Object.assign(baseOptions(), {
          scales: {
            x: tauTimeAxis(getTau, SPAN_IN_TAU),
            y: {
              beginAtZero: true,
              grace: '8%',
              title: { display: true, text: 'Output y(t)', font: { weight: '600' } },
              grid: { color: THEME.grid },
              border: { color: THEME.axis }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: Object.assign(tooltipStyle(), {
              itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
              callbacks: { title: timeTitle, label: mainTooltipLabel, footer: mainTooltipFooter }
            })
          }
        }),
        plugins: [createGuidesPlugin(() => mainGuides)]
      });

      logChart = new Chart(ui.logCanvas, {
        type: 'line',
        data: {
          datasets: [
            { role: 'fraction', label: 'Error fraction f(t)', yAxisID: 'y', data: [], borderColor: THEME.output,
              backgroundColor: THEME.output, pointHoverBackgroundColor: '#fff', borderWidth: 2.75, order: 0 },
            { role: 'reference', label: 'Reference', yAxisID: 'y', data: [], borderColor: THEME.reference,
              backgroundColor: THEME.reference, pointHoverBackgroundColor: '#fff', borderWidth: 2, borderDash: [2, 3], order: 1, hidden: true }
          ]
        },
        options: Object.assign(baseOptions(), {
          scales: {
            x: tauTimeAxis(getTau, SPAN_IN_TAU),
            // Left axis: the error fraction itself, decades 1 … 0.001 (log scale, never zero).
            y: {
              type: 'logarithmic', position: 'left', min: LOG_AXIS_MIN, max: 1,
              title: { display: true, text: 'Error fraction f(t), log scale', font: { weight: '600' } },
              grid: { drawOnChartArea: false },
              border: { color: THEME.axis },
              afterBuildTicks: (axis) => { axis.ticks = [1, 0.1, 0.01, 0.001].map((value) => ({ value })); },
              ticks: { callback: (value) => String(value) }
            },
            // Right axis: the same scale labelled as ln f = 0, −1, …, −6. Its gridlines meet the
            // τ gridlines on the curve, which makes the slope −1/τ visible.
            yLn: {
              type: 'logarithmic', position: 'right', min: LOG_AXIS_MIN, max: 1,
              title: { display: true, text: 'ln f(t)', font: { weight: '600' } },
              grid: { color: THEME.grid },
              border: { color: THEME.axis },
              afterBuildTicks: (axis) => { axis.ticks = [0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: Math.exp(-n) })); },
              ticks: { callback: (value) => fmt(Math.log(value), 0) }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: Object.assign(tooltipStyle(), {
              itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
              callbacks: {
                title: timeTitle,
                label: (item) => ` ${item.dataset.label}: ${item.parsed.y.toPrecision(3)}`,
                footer: (items) => {
                  const f = items.find((i) => i.dataset.role === 'fraction');
                  return f ? `ln f(t) = ${fmt(Math.log(f.parsed.y), 3)} = −t/τ` : '';
                }
              }
            })
          }
        }),
        plugins: [createGuidesPlugin(() => logGuides)]
      });
    }

    function mainTooltipLabel(item) {
      const y = item.parsed.y;
      if (item.dataset.role === 'output' && state.input === 'step') {
        return ` Sensor output y(t): ${fmt(y, 3)}  (${fmt((100 * y) / (state.K * A), 1)}% of KA)`;
      }
      return ` ${item.dataset.label}: ${fmt(y, 3)}`;
    }

    function mainTooltipFooter(items) {
      const ideal = items.find((i) => i.dataset.role === 'ideal');
      const output = items.find((i) => i.dataset.role === 'output');
      if (!ideal || !output) return '';
      if (state.input === 'ramp') {
        return [
          `Tracking error e(t) = Kx − y = ${fmt(ideal.parsed.y - output.parsed.y, 3)}`,
          `Approaches KAτ = ${fmt(state.K * A * state.tau, 3)} as t grows`
        ];
      }
      const n = output.dataIndex / SAMPLES_PER_TAU;
      if (n === 1) return 'One time constant: 63.2% of the final value';
      if (n === 3) return 'Three time constants: 95% of the final value';
      return '';
    }

    /** Step annotations: drop lines and markers at τ and 3τ, final-value label. */
    function stepGuides(K, tau) {
      const KA = K * A;
      const yTau = FirstOrder.stepResponse(tau, K, tau, A);
      const y3Tau = FirstOrder.stepResponse(3 * tau, K, tau, A);
      const pctTau = fmt((100 * yTau) / KA, 1);
      const pct3Tau = fmt((100 * y3Tau) / KA, 1);
      const dropLines = (x, y, color) => [
        { x1: x, y1: 0, x2: x, y2: y, color: hexToRgba(color, 0.75), dash: [3, 4] },
        { x1: 0, y1: y, x2: x, y2: y, color: hexToRgba(color, 0.75), dash: [3, 4] }
      ];
      return {
        lines: [...dropLines(tau, yTau, THEME.tau), ...dropLines(3 * tau, y3Tau, THEME.tau3)],
        markers: [
          { x: tau, y: yTau, color: THEME.tau },
          { x: 3 * tau, y: y3Tau, color: THEME.tau3 }
        ],
        labels: [
          { x: tau, y: yTau, dx: 10, dy: 15, text: `${pctTau}% of KA at t = τ`, short: `${pctTau}%`, color: THEME.tau },
          { x: 3 * tau, y: y3Tau, dx: 10, dy: 15, text: `${pct3Tau}% of KA at t = 3τ`, short: `${pct3Tau}%`, color: THEME.tau3 },
          { x: SPAN_IN_TAU * tau, y: KA, dx: -2, dy: -14, align: 'right',
            text: `Final value KA = ${fmt(KA, 3)}`, short: `KA = ${fmt(KA, 3)}`, color: THEME.ideal }
        ]
      };
    }

    /** Ramp annotations: vertical error bracket and horizontal lag bracket at t = 4τ. */
    function rampGuides(K, tau) {
      const KA = K * A;
      const t1 = RAMP_MARK_IN_TAU * tau;
      const y1 = FirstOrder.rampResponse(t1, K, tau, A);   // sensor output at t1
      const ideal1 = KA * t1;                              // ideal output at t1
      const tSame = y1 / KA;                               // when the ideal ramp had the value y1
      return {
        segments: [
          { x1: t1, y1: y1, x2: t1, y2: ideal1, color: THEME.error, width: 2.5, caps: true },
          { x1: tSame, y1: y1, x2: t1, y2: y1, color: THEME.tau, width: 2.5, caps: true }
        ],
        labels: [
          { x: t1, y: y1, dx: 10, dy: 14, text: `Error ≈ KAτ = ${fmt(KA * tau, 2)}`, short: '≈ KAτ', color: THEME.errorText },
          { x: tSame, y: y1, dx: -8, dy: -13, align: 'right', text: `Lag ≈ τ = ${fmt(tau, 1)} s`, short: '≈ τ', color: THEME.tau }
        ]
      };
    }

    /** Log-chart annotations: markers at τ and 3τ and a slope triangle from τ to 2τ. */
    function errorFractionGuides(tau) {
      const f1 = FirstOrder.stepErrorFraction(tau, tau);       // e^−1
      const f2 = FirstOrder.stepErrorFraction(2 * tau, tau);   // e^−2
      const f3 = FirstOrder.stepErrorFraction(3 * tau, tau);   // e^−3
      return {
        segments: [
          { x1: tau, y1: f1, x2: 2 * tau, y2: f1, color: THEME.error, width: 2 },
          { x1: 2 * tau, y1: f1, x2: 2 * tau, y2: f2, color: THEME.error, width: 2 }
        ],
        markers: [
          { x: tau, y: f1, color: THEME.tau },
          { x: 3 * tau, y: f3, color: THEME.tau3 }
        ],
        labels: [
          { x: 1.5 * tau, y: f1, dy: -13, align: 'center', text: 'Δt = τ', color: THEME.errorText },
          { x: 2 * tau, y: Math.sqrt(f1 * f2), dx: 9, text: 'Δ ln f = −1', color: THEME.errorText },
          { x: tau, y: f1, dx: -10, dy: 15, align: 'right', text: `${fmt(100 * f1, 1)}% left at t = τ`, short: `${fmt(100 * f1, 1)}%`, color: THEME.tau },
          { x: 3 * tau, y: f3, dx: -10, dy: 15, align: 'right', text: `${fmt(100 * f3, 1)}% left at t = 3τ`, short: `${fmt(100 * f3, 1)}%`, color: THEME.tau3 }
        ]
      };
    }

    function mainLegendItems(isStep, ref) {
      const items = isStep
        ? [
            { label: 'Ideal input K·x(t) = KA', kind: 'dashed', color: THEME.ideal },
            { label: 'Sensor output y(t)', kind: 'line', color: THEME.output },
            { label: '63.2% point at t = τ', kind: 'dot', color: THEME.tau },
            { label: '95% point at t = 3τ', kind: 'dot', color: THEME.tau3 }
          ]
        : [
            { label: 'Ideal ramp K·x(t) = KAt', kind: 'dashed', color: THEME.ideal },
            { label: 'Sensor output y(t)', kind: 'line', color: THEME.output },
            { label: 'Error at t = 4τ (vertical, output units)', kind: 'vbar', color: THEME.error },
            { label: 'Lag at t = 4τ (horizontal, seconds)', kind: 'hbar', color: THEME.tau }
          ];
      if (ref) items.push({ label: `Reference output (${referenceText(ref)})`, kind: 'dotted', color: THEME.reference });
      return items;
    }

    /* ---------- Validation (official test 1, first-order step) ---------- */
    function validationChecks(K, tau) {
      const KA = K * A;
      const tolerance = 0.001;
      const cases = [
        { name: 'Test 1a: step output at t = τ', time: tau, expected: 0.632 },
        { name: 'Test 1b: step output at t = 3τ', time: 3 * tau, expected: 0.950 }
      ];
      return cases.map(({ name, time, expected }) => {
        const y = FirstOrder.stepResponse(time, K, tau, A);   // the real formula, not a stored number
        const ratio = y / KA;
        return {
          name,
          detail: `t = ${fmt(time, 2)} s with K = ${K.toFixed(1)}, τ = ${tau.toFixed(1)} s`,
          expected: { main: `${expected.toFixed(3)} KA`, sub: `= ${fmt(expected * KA, 3)}` },
          calculated: { main: `${ratio.toFixed(4)} KA`, sub: `y = ${fmt(y, 4)}` },
          pass: Math.abs(ratio - expected) <= tolerance
        };
      });
    }

    /* ---------- Render everything from the current state ---------- */
    function render() {
      const { K, tau, input } = state;
      const KA = K * A;
      const isStep = input === 'step';
      const ref = visibleReference();
      const times = timeGrid(tau);

      // Headings and equations
      ui.chartTitle.textContent = isStep ? 'Step response' : 'Ramp response';
      ui.chartSub.textContent = isStep
        ? 'How the sensor output follows a sudden change of input.'
        : 'How the sensor output trails a steadily rising input.';
      ui.paramChip.textContent = `K = ${K.toFixed(1)}, τ = ${tau.toFixed(1)} s, A = 1`;
      ui.eqStep.hidden = !isStep;
      ui.eqRamp.hidden = isStep;
      renderLegend(ui.mainLegend, mainLegendItems(isStep, ref));

      // Main chart
      if (mainChart) {
        const [idealSet, outputSet, refSet] = mainChart.data.datasets;
        idealSet.label = isStep ? 'Ideal input K·x(t)' : 'Ideal ramp K·x(t)';
        idealSet.data = times.map((t) => ({ x: t, y: idealOutput(t, K, input) }));
        outputSet.data = times.map((t) => ({ x: t, y: sensorOutput(t, K, tau, input) }));
        refSet.hidden = !ref;
        refSet.label = ref ? `Reference (${referenceText(ref)})` : 'Reference';
        refSet.data = ref ? times.map((t) => ({ x: t, y: sensorOutput(t, ref.K, ref.tau, input) })) : [];
        mainChart.options.scales.x.max = SPAN_IN_TAU * tau;
        mainGuides = isStep ? stepGuides(K, tau) : rampGuides(K, tau);
        mainChart.update('none');
      }

      // Metrics and explanation cards
      ui.metricsStep.hidden = !isStep;
      ui.stepCallout.hidden = !isStep;
      ui.metricsRamp.hidden = isStep;
      ui.rampCallout.hidden = isStep;
      const yTau = FirstOrder.stepResponse(tau, K, tau, A);
      const y3Tau = FirstOrder.stepResponse(3 * tau, K, tau, A);
      const ess = FirstOrder.rampError(Infinity, K, tau, A);   // e(t) as t → ∞ equals KAτ
      if (isStep) {
        $('m1-step-tau').textContent = fmt(tau, 2);
        $('m1-step-final').textContent = fmt(KA, 3);
        $('m1-step-ytau').textContent = fmt(yTau, 3);
        $('m1-step-ytau-note').textContent = `${fmt((100 * yTau) / KA, 1)}% of KA, reached at t = ${fmt(tau, 2)} s.`;
        $('m1-step-y3tau').textContent = fmt(y3Tau, 3);
        $('m1-step-y3tau-note').textContent = `${fmt((100 * y3Tau) / KA, 1)}% of KA, reached at t = ${fmt(3 * tau, 2)} s.`;
        $('m1-step-rise').textContent = fmt(FirstOrder.riseTime(tau), 2);
      } else {
        $('m1-ramp-tau').textContent = fmt(tau, 2);
        $('m1-ramp-slope').textContent = fmt(KA, 2);
        $('m1-ramp-ess').textContent = fmt(ess, 2);
        $('m1-ramp-lag').textContent = fmt(tau, 2);
        ui.rampLive.textContent = `With K = ${K.toFixed(1)} and τ = ${tau.toFixed(1)} s, the ideal output climbs ${fmt(KA, 2)} units every second and the sensor is ${fmt(tau, 2)} s behind, so it sits ${fmt(KA, 2)} × ${fmt(tau, 2)} = ${fmt(ess, 2)} units below the ideal line.`;
      }

      // Logarithmic error-fraction chart (always the STEP error fraction)
      const fractions = times.map((t) => FirstOrder.stepErrorFraction(t, tau));
      const i1 = SAMPLES_PER_TAU;
      const i3 = 3 * SAMPLES_PER_TAU;
      const slopeRead = (Math.log(fractions[i3]) - Math.log(fractions[i1])) / (times[i3] - times[i1]);
      const slopeTheory = -1 / tau;
      ui.slopeChip.textContent = `slope of ln f = ${fmt(slopeTheory, 3)} s⁻¹`;
      ui.slopeTheory.textContent = `${fmt(slopeTheory, 3)} s⁻¹`;
      ui.slopeRead.textContent = `${fmt(slopeRead, 3)} s⁻¹`;
      ui.tauEstimate.textContent = `${fmt(-1 / slopeRead, 2)} s`;
      ui.logRampNote.hidden = isStep;
      const logRef = ref && Math.abs(ref.tau - tau) > 1e-9 ? ref : null;   // K does not change f(t)
      const logLegend = [
        { label: 'Error fraction f(t), step response', kind: 'line', color: THEME.output },
        { label: 'Slope triangle: ln f falls by 1 per τ', kind: 'hbar', color: THEME.error }
      ];
      if (logRef) logLegend.push({ label: `Reference (τ = ${logRef.tau.toFixed(1)} s)`, kind: 'dotted', color: THEME.reference });
      renderLegend(ui.logLegend, logLegend);
      if (logChart) {
        const [fractionSet, refSet] = logChart.data.datasets;
        fractionSet.data = times.map((t, i) => ({ x: t, y: fractions[i] }));
        refSet.hidden = !logRef;
        refSet.label = logRef ? `Reference (τ = ${logRef.tau.toFixed(1)} s)` : 'Reference';
        refSet.data = logRef
          ? times.map((t) => {
              const f = FirstOrder.stepErrorFraction(t, logRef.tau);
              return { x: t, y: f < 1e-4 ? null : f };    // far below the axis: leave a gap
            })
          : [];
        logChart.options.scales.x.max = SPAN_IN_TAU * tau;
        logGuides = errorFractionGuides(tau);
        logChart.update('none');
      }

      // Validation table
      const checks = validationChecks(K, tau);
      const passed = renderValidation(ui.validationBody, checks);
      ui.validationSummary.textContent = `${passed} of ${checks.length} passed`;
      ui.validationSummary.className = 'chip ' + (passed === checks.length ? 'chip--pass' : 'chip--fail');

      // Reference controls
      const stored = state.reference;
      if (!stored) {
        ui.refStatus.textContent = 'No reference curve. Pin the current curve to compare it with later settings.';
      } else if (!ref) {
        ui.refStatus.textContent = `Reference: ${referenceText(stored)}. It matches the live curve, so it is hidden until you move a slider.`;
      } else {
        ui.refStatus.textContent = `Dotted reference: ${referenceText(stored)}.`;
      }
      ui.pin.disabled = Boolean(stored) && !ref;
      ui.unpin.disabled = !stored;

      // Text descriptions of the charts for screen readers
      ui.mainCanvas.setAttribute('aria-label', isStep
        ? `Step response for K = ${K.toFixed(1)} and τ = ${tau.toFixed(1)} s. The output rises from 0 toward ${fmt(KA, 3)}, reaching ${fmt(yTau, 3)} at t = ${fmt(tau, 2)} s and ${fmt(y3Tau, 3)} at t = ${fmt(3 * tau, 2)} s.`
        : `Ramp response for K = ${K.toFixed(1)} and τ = ${tau.toFixed(1)} s. The output runs parallel to the ideal ramp of slope ${fmt(KA, 2)} per second, ${fmt(tau, 2)} s behind it, with a steady-state error of ${fmt(ess, 2)}.`);
      ui.logCanvas.setAttribute('aria-label',
        `Step-response error fraction on a logarithmic axis for τ = ${tau.toFixed(1)} s: a straight line with slope ${fmt(slopeTheory, 3)} per second.`);
    }

    /* ---------- Controls ---------- */

    /** Paint the slider track up to the thumb. */
    function setSliderFill(slider) {
      const min = Number(slider.min);
      const max = Number(slider.max);
      const pct = ((Number(slider.value) - min) / (max - min)) * 100;
      slider.style.setProperty('--fill', `${pct}%`);
    }

    /** Copy the state into the controls' readouts and accessible labels. */
    function syncControls() {
      ui.kSlider.value = String(state.K);
      ui.tauSlider.value = String(state.tau);
      ui.kValue.textContent = state.K.toFixed(1);
      ui.tauValue.textContent = `${state.tau.toFixed(1)} s`;
      ui.kSlider.setAttribute('aria-valuetext', `K equals ${state.K.toFixed(1)}`);
      ui.tauSlider.setAttribute('aria-valuetext', `${state.tau.toFixed(1)} seconds`);
      setSliderFill(ui.kSlider);
      setSliderFill(ui.tauSlider);
      ui.inputRadios.forEach((radio) => { radio.checked = radio.value === state.input; });
      ui.inputHelp.textContent = state.input === 'step'
        ? 'x(t) = A for t ≥ 0: a sudden change, like plunging a thermometer into tea.'
        : 'x(t) = A·t: a steadily rising input, like an oven warming up at a constant rate.';
    }

    function onControlChange() {
      syncControls();
      render();
      predict.notifyInteraction();
    }

    ui.kSlider.addEventListener('input', () => { state.K = Number(ui.kSlider.value); onControlChange(); });
    ui.tauSlider.addEventListener('input', () => { state.tau = Number(ui.tauSlider.value); onControlChange(); });
    ui.inputRadios.forEach((radio) => radio.addEventListener('change', () => {
      if (radio.checked) { state.input = radio.value; onControlChange(); }
    }));

    ui.reset.addEventListener('click', () => {
      state.K = DEFAULTS.K;
      state.tau = DEFAULTS.tau;
      state.input = DEFAULTS.input;
      state.reference = { K: DEFAULTS.K, tau: DEFAULTS.tau };
      syncControls();
      render();
    });

    function pinCurrentCurve() {
      state.reference = { K: state.K, tau: state.tau };
      render();
    }
    ui.pin.addEventListener('click', pinCurrentCurve);
    ui.unpin.addEventListener('click', () => { state.reference = null; render(); });

    // "Predict, then check": checking pins the current curve so the user can compare after moving a slider.
    const predict = createPredictCheck($('m1-predict'), QUESTIONS, { onCheck: pinCurrentCurve });

    createCharts();
    syncControls();
    render();
  }

  /* =========================================================================
     4. START-UP — teammates: call initModule2(), initModule3(), … here.
     ========================================================================= */
  initModule1();
  