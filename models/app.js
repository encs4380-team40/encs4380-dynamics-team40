(function () {
  const page = document.documentElement.dataset.model;
  if (page === "home") {
    const legacy = /^#module-([1-4])$/.exec(window.location.hash);
    if (legacy) {
      window.location.replace("models/model" + legacy[1] + ".html");
      return;
    }
    // The former #control link now opens the homework chooser.
    return;
  }

  const navigation = document.querySelector(".tk-nav");
  if (navigation) {
    const measureNavigation = () => {
      const sticky = getComputedStyle(navigation).position === "sticky";
      document.documentElement.style.setProperty("--tk-nav-h", sticky ? navigation.offsetHeight + "px" : "0px");
    };
    if ("ResizeObserver" in window) new ResizeObserver(measureNavigation).observe(navigation);
    window.addEventListener("resize", measureNavigation);
    measureNavigation();
  }

if (/^model[1-4]$/.test(page)) {

  /* =========================================================================
     SHARED TOOLKIT HELPERS, written for Module 1 and reused by Module 3:
     number formatting, chart theme, a small annotation plugin, legends, the
     validation table and the "Predict, then check" component.
     ========================================================================= */
  const Toolkit = (function () {
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
    ring:   (c) => `<circle cx="12" cy="6" r="4.5" fill="none" stroke="${c}" stroke-width="2"/>`,
    cross:  (c) => `<path d="M8.5 2.5l7 7M15.5 2.5l-7 7" stroke="${c}" stroke-width="2.25" stroke-linecap="round"/>`,
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

    // One chart theme (fonts, text and grid colours) for every module's charts.
    if (CHARTS_AVAILABLE) applyChartDefaults();

    return { fmt, fmtTick, escapeHtml, hexToRgba, applyChartDefaults, tooltipStyle, tauTimeAxis, createGuidesPlugin, drawClipped, toPixels, drawSegment, drawMarker, roundedRectPath, drawLabel, renderLegend, renderValidation, validationCell, statusCell, createPredictCheck, THEME, CHARTS_AVAILABLE, LEGEND_SWATCHES };
  })();
  
if (page === "model1") {

  /* =========================================================================
     MODULE 1: FIRST-ORDER TIME RESPONSE
     Wrapped in its own function so its names cannot clash with other modules.
     ========================================================================= */
  (function () {
    'use strict';
    const { fmt, fmtTick, escapeHtml, hexToRgba, applyChartDefaults, tooltipStyle, tauTimeAxis, createGuidesPlugin, drawClipped, toPixels, drawSegment, drawMarker, roundedRectPath, drawLabel, renderLegend, renderValidation, validationCell, statusCell, createPredictCheck, THEME, CHARTS_AVAILABLE, LEGEND_SWATCHES } = Toolkit;
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
        document.getElementById('m1-root').querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = false; });
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


  initModule1();
  })();
  
}
if (page === "model2") {

  /* =========================================================================
     MODULE 2: FIRST-ORDER FREQUENCY RESPONSE
     Wrapped in its own function so its names cannot clash with other modules.
     ========================================================================= */
  (function () {

    // Get the tau slider.
    const tauSlider = document.getElementById("m2-tau");
    const tauValue = document.getElementById("m2-tau-value");

    // Get the frequency slider.
    const frequencySlider = document.getElementById("m2-frequency");
    const frequencyValue = document.getElementById("m2-frequency-value");
    const tauNumber = document.getElementById("m2-tau-number");
    const frequencyNumber = document.getElementById("m2-frequency-number");
    const inputStatus = document.getElementById("m2-input-status");

    const amplitudeValue = document.getElementById("m2-amplitude");
    const phaseValue = document.getElementById("m2-phase");
    const cutoffAngularValue = document.getElementById("m2-cutoff-angular");
    const cutoffHzValue = document.getElementById("m2-cutoff-hz");
    const dynamicErrorValue = document.getElementById("m2-dynamic-error");
  function createPredictCheck(root, questions, hooks = {}) {
    const part = (role) => root.querySelector(`[data-role="${role}"]`);
    const prompt = part('prompt');
    const choicesBox = part('choices');
    const retryBtn = part('retry');
    const skipBtn = part('skip');
    const nextBtn = part('next');
    const hint = part('hint');
    const feedback = part('feedback');
    const progress = part('progress');
    const steps = root.querySelectorAll('[data-step]');
    const groupName = root.id + '-choice';
    let current = 0;
    let checked = false;
    let observed = false;
    let predictionSaved = false;

    // Update the question steps.
    function setStage(stage) {
      const order = ['predict', 'observe', 'check'];
      const activeIndex = stage === 'done' ? 3 : order.indexOf(stage);
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
      predictionSaved = false;
      root.querySelector('[data-step="observe"]').textContent = 'Try the controls';
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
      hint.hidden = false;
      hint.textContent = 'Choose your answer first.';
      retryBtn.hidden = true;
      skipBtn.hidden = true;
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

    // Save the choice as soon as it is selected.
    choicesBox.addEventListener('change', () => {
      if (checked || !choicesBox.querySelector('input:checked')) return;
      predictionSaved = true;
      retryBtn.hidden = true;
      skipBtn.hidden = false;
      hint.hidden = false;
      hint.textContent = 'Change the values to check your answer.';
      setStage('observe');
    });

    // Show the result after a control changes.
    function revealAnswer(skipMoving = false) {
      if (!predictionSaved || (!observed && !skipMoving) || checked) return;
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
      if (skipMoving) addParagraph('You skipped the experiment. You can still try the controls to explore the result.');
      feedback.hidden = false;
      skipBtn.hidden = true;
      retryBtn.hidden = false;
      nextBtn.hidden = current === questions.length - 1;
      nextBtn.textContent = 'Next question';
      hint.hidden = true;
      setStage('done');
      if (skipMoving) {
        const observeStep = root.querySelector('[data-step="observe"]');
        observeStep.classList.remove('is-done');
        observeStep.textContent = 'Try the controls (skipped)';
      }
      if (hooks.onCheck) hooks.onCheck(q, isCorrect);
    }

    skipBtn.addEventListener('click', () => {
      revealAnswer(true);
    });

    // Fix: these two listeners were outside this function, where retryBtn does not exist, so the
    // whole script stopped with a ReferenceError. "Try again" now returns to question 1, and
    // "Next question" (which had no listener at all) moves to the next one.
    retryBtn.addEventListener('click', () => {
      current = 0;
      renderQuestion();
      const first = choicesBox.querySelector('input');
      if (first) first.focus();
    });
    nextBtn.addEventListener('click', () => {
      current = Math.min(current + 1, questions.length - 1);
      renderQuestion();
      prompt.scrollIntoView({ block: 'nearest' });
    });



    renderQuestion();

    return {
      notifyInteraction() {
        if (!predictionSaved || checked || observed) return;
        observed = true;
        revealAnswer();
      }
    };
  }


    // Our three questions.
    const predictionQuestions = [
      {
        prompt: "With τ fixed, what happens to output amplitude when frequency increases?",
        choices: [{ text: "It increases.", correct: false }, { text: "It decreases.", correct: true }, { text: "It stays the same.", correct: false }],
        explanation: "M = 1 / √(1 + (ωτ)²). Increasing frequency increases ωτ, so M decreases.",
        tryIt: "Try it: set τ = 0.2 s, then increase frequency from 1 to 2 Hz. Watch the orange output wave shrink."
      },
      {
        prompt: "If τ doubles, what happens to the cutoff frequency?",
        choices: [{ text: "It doubles.", correct: false }, { text: "It stays the same.", correct: false }, { text: "It halves.", correct: true }],
        explanation: "fc = 1 / (2π τ), so doubling τ halves fc. A slower sensor has a smaller useful frequency range.",
        tryIt: "Try it: change τ from 0.2 to 0.4 s. The cutoff falls from about 0.796 to 0.398 Hz."
      },
      {
        prompt: "At cutoff (ωτ = 1), what are the amplitude ratio and phase shift?",
        choices: [{ text: "M = 1 and φ = 0°.", correct: false }, { text: "M ≈ 0.707 and φ = −45°.", correct: true }, { text: "M = 0.5 and φ = −90°.", correct: false }],
        explanation: "Substitute ωτ = 1: M = 1 / √2 and φ = −tan⁻¹(1) = −45°. The magnitude is about −3.01 dB.",
        tryIt: "Try it: set τ = 0.2 s and frequency = 0.795774715 Hz. The selected-frequency markers meet the cutoff markers."
      }
    ];
    const predict = createPredictCheck(document.getElementById("m2-predict"), predictionQuestions);

    // Set up the graphs.
    let sineChart = null;
    let magnitudeChart = null;
    let phaseChart = null;

    // Use this for both Bode graphs.
    function createBodeChart(canvasId, axisTitle) {
      return new Chart(document.getElementById(canvasId), {
        type: "line",
        data: {
          datasets: [
            { label: "Response", data: [], borderColor: "#2563eb", borderWidth: 2, pointRadius: 0 },
            { label: "Cutoff", data: [], backgroundColor: "#15803d", pointRadius: 6, showLine: false },
            { label: "Selected frequency", data: [], backgroundColor: "#c2410c", pointStyle: "triangle", pointRadius: 7, showLine: false }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            x: { type: "logarithmic", title: { display: true, text: "Frequency (Hz)" } },
            y: { title: { display: true, text: axisTitle } }
          }
        }
      });
    }

    if (typeof Chart !== "undefined") {
      magnitudeChart = createBodeChart("m2-bode-magnitude", "Magnitude (dB)");
      phaseChart = createBodeChart("m2-bode-phase", "Phase (degrees)");
      sineChart = new Chart(document.getElementById("m2-sine-chart"), {
        type: "line",
        data: {
          datasets: [
            { label: "Input", data: [], borderColor: "#2563eb", pointRadius: 0, borderWidth: 2 },
            { label: "Output", data: [], borderColor: "#c2410c", borderDash: [6, 4], pointRadius: 0, borderWidth: 2 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            x: { type: "linear", title: { display: true, text: "Time (seconds)" } },
            y: { min: -1.1, max: 1.1, title: { display: true, text: "Amplitude" } }
          }
        }
      });
    } else {
      document.getElementById("m2-chart-status").textContent =
        "The graph library could not load. Check your internet connection and refresh. The calculations still work.";
    }

    // Calculate amplitude and phase.
    function calculateResponse(tau, omega) {
      const amplitudeRatio = 1 / Math.sqrt(1 + (omega * tau) ** 2);
      const phaseRadians = -Math.atan(omega * tau);
      const phaseDegrees = phaseRadians * 180 / Math.PI;
      return { amplitudeRatio, phaseRadians, phaseDegrees };
    }

    function runValidation() {
      // For sin(2t), omega is 2 rad/s.
      const sineExample = calculateResponse(0.2, 2);
      const maximumTau = Math.sqrt(1 / 0.95 ** 2 - 1) / (2 * Math.PI * 100);
      const responseAt50Hz = calculateResponse(maximumTau, 2 * Math.PI * 50);
      const checks = [
        { name: "Check 2: amplitude ratio, τ = 0.2 s, ω = 2 rad/s", expected: 0.93, actual: sineExample.amplitudeRatio, tolerance: 0.005, unit: "" },
        { name: "Check 2: phase lag, τ = 0.2 s, ω = 2 rad/s", expected: 21.8, actual: -sineExample.phaseDegrees, tolerance: 0.05, unit: "°" },
        { name: "Check 3: maximum τ at 100 Hz, 5% error", expected: 0.52, actual: maximumTau * 1000, tolerance: 0.005, unit: " ms" },
        { name: "Check 3: phase lag at 50 Hz using τmax", expected: 9.3, actual: -responseAt50Hz.phaseDegrees, tolerance: 0.05, unit: "°" }
      ];
      const results = document.getElementById("m2-validation-results");
      results.replaceChildren();

      // Add the test results.
      for (const check of checks) {
        const passed = Math.abs(check.actual - check.expected) <= check.tolerance;
        const row = document.createElement("tr");
        const values = [check.name, check.expected + check.unit, check.actual.toFixed(4) + check.unit,
          "±" + check.tolerance + check.unit];
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }
        const statusCell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "status " + (passed ? "status--pass" : "status--fail");
        badge.textContent = passed ? "PASS" : "FAIL";
        statusCell.appendChild(badge);
        row.appendChild(statusCell);
        results.appendChild(row);
      }
    }

    function updateResponse() {
      // Convert the values to numbers.
      const tau = Number(tauSlider.dataset.actualValue);
      const frequency = Number(frequencySlider.dataset.actualValue);

      // Convert Hz to rad/s.
      const omega = 2 * Math.PI * frequency;
      const { amplitudeRatio, phaseRadians, phaseDegrees } = calculateResponse(tau, omega);

      // Calculate cutoff and error.
      const cutoffAngular = 1 / tau;
      const cutoffHz = cutoffAngular / (2 * Math.PI);
      const dynamicError = amplitudeRatio - 1;

      // Round the displayed results.
      // Fill each track up to its handle.
      for (const slider of [tauSlider, frequencySlider]) {
        const fill = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100;
        slider.style.setProperty('--fill', fill + '%');
      }
      tauValue.textContent = tau.toPrecision(6) + " s";
      frequencyValue.textContent = frequency.toPrecision(6) + " Hz";
      amplitudeValue.textContent = amplitudeRatio.toFixed(3);
      phaseValue.textContent = phaseDegrees.toFixed(1) + "°";
      cutoffAngularValue.textContent = cutoffAngular.toFixed(3) + " rad/s";
      cutoffHzValue.textContent = cutoffHz.toFixed(3) + " Hz";
      dynamicErrorValue.textContent = dynamicError.toFixed(4) + " (" + (dynamicError * 100).toFixed(2) + "%)";

      if (magnitudeChart && phaseChart) {
        const magnitudePoints = [];
        const phasePoints = [];
        const minimumFrequency = Math.min(cutoffHz / 100, frequency / 10);
        const maximumFrequency = Math.max(cutoffHz * 100, frequency * 10);

        // Use log spacing.
        for (let sample = 0; sample <= 400; sample++) {
          const plotFrequency = minimumFrequency * (maximumFrequency / minimumFrequency) ** (sample / 400);
          const omegaTau = 2 * Math.PI * plotFrequency * tau;
          const ratio = 1 / Math.sqrt(1 + omegaTau ** 2);
          magnitudePoints.push({ x: plotFrequency, y: 20 * Math.log10(ratio) });
          phasePoints.push({ x: plotFrequency, y: -Math.atan(omegaTau) * 180 / Math.PI });
        }

        // Add the graph markers.
        magnitudeChart.data.datasets[0].data = magnitudePoints;
        magnitudeChart.data.datasets[1].data = [{ x: cutoffHz, y: 20 * Math.log10(1 / Math.sqrt(2)) }];
        magnitudeChart.data.datasets[2].data = [{ x: frequency, y: 20 * Math.log10(amplitudeRatio) }];
        phaseChart.data.datasets[0].data = phasePoints;
        phaseChart.data.datasets[1].data = [{ x: cutoffHz, y: -45 }];
        phaseChart.data.datasets[2].data = [{ x: frequency, y: phaseDegrees }];
        magnitudeChart.update();
        phaseChart.update();
      }

      if (sineChart) {
        const inputPoints = [];
        const outputPoints = [];
        const duration = 3 / frequency;

        // Draw three cycles.
        for (let sample = 0; sample <= 600; sample++) {
          const time = sample * duration / 600;
          const input = Math.sin(omega * time);
          const output = amplitudeRatio * Math.sin(omega * time + phaseRadians);
          inputPoints.push({ x: time, y: input });
          outputPoints.push({ x: time, y: output });
        }

        // Update the graph.
        sineChart.data.datasets[0].data = inputPoints;
        sineChart.data.datasets[1].data = outputPoints;
        sineChart.options.scales.x.max = duration;
        sineChart.update();
      }
    }

    // Keep the controls in sync.
    function connectControls(slider, numberInput, name) {
      const minimum = Number(numberInput.min);
      const maximum = Number(numberInput.max);

      // Convert the real value to a position on the track.
      function syncPosition() {
        const actualValue = Number(numberInput.value);
        slider.value = 1000 * Math.log(actualValue / minimum) / Math.log(maximum / minimum);
        slider.dataset.actualValue = actualValue;
        slider.setAttribute('aria-valuetext', actualValue.toPrecision(6) + (slider === tauSlider ? ' seconds' : ' Hz'));
      }

      syncPosition();
      slider.addEventListener("input", function () {
        // Convert the track position back to seconds or Hz.
        const fraction = Number(slider.value) / 1000;
        const actualValue = minimum * (maximum / minimum) ** fraction;
        numberInput.value = Math.min(maximum, Math.max(minimum, actualValue));
        syncPosition();
        inputStatus.textContent = "";
        updateResponse();
        predict.notifyInteraction();
      });
      numberInput.addEventListener("input", function () {
        // Check the entered number.
        if (!numberInput.checkValidity() || !Number.isFinite(numberInput.valueAsNumber)) {
          inputStatus.textContent = "Enter " + name + " between " + numberInput.min + " and " + numberInput.max + ". The graphs still show the last valid values.";
          return;
        }
        syncPosition();
        inputStatus.textContent = "";
        updateResponse();
        predict.notifyInteraction();
      });
    }

    connectControls(tauSlider, tauNumber, "τ in seconds");
    connectControls(frequencySlider, frequencyNumber, "frequency in Hz");

    // Show the starting results.
    updateResponse();
    runValidation();
  })();
  
}
if (page === "model3") {

  /* =========================================================================
     MODULE 3: SECOND-ORDER RESPONSE AND STATE SPACE
     Wrapped in its own function so its names cannot clash with other modules.
     ========================================================================= */
  (function () {
    'use strict';
    const { fmt, fmtTick, escapeHtml, hexToRgba, applyChartDefaults, tooltipStyle, tauTimeAxis, createGuidesPlugin, drawClipped, toPixels, drawSegment, drawMarker, roundedRectPath, drawLabel, renderLegend, renderValidation, validationCell, statusCell, createPredictCheck, THEME, CHARTS_AVAILABLE, LEGEND_SWATCHES } = Toolkit;
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
      sLegend: $('m3-s-legend'), sEig: $('m3-s-eig'), sCanvas: $('m3-s-chart'), sChip: $('m3-s-chip'),
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
        document.getElementById('m3-root').querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = false; });
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
              borderColor: THEME.output, borderWidth: 3.5, order: 0 },
            { role: 'eig', label: 'Eigenvalues of A', data: [], showLine: false, pointStyle: 'circle', pointRadius: 13, hoverRadius: 14,
              borderColor: THEME.tau, backgroundColor: 'rgba(0, 0, 0, 0)', borderWidth: 2, order: 1 }
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
      // Fix: square view with equal scales (so the |s| = wn circle stays round) that always contains the
      // left half of that circle, the origin and every pole, plus an 18% margin. The old fixed limits
      // (+-0.625 * 1.18 * wn vertically) cut the poles off the plot whenever zeta was below about 0.67.
      const marked = [...poles, ...refPoles];
      const left = Math.min(-d.wn, ...marked.map((p) => p.re));
      const top = Math.max(d.wn, ...marked.map((p) => Math.abs(p.im)));
      const side = 1.18 * Math.max(-left, 2 * top);
      const centreX = left / 2;
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

      const eig = SecondOrder.eigenvalues(d.m, d.b, d.k);   // computed from A, independently of the poles
      const [circleSet, refSet, poleSet, eigSet] = sChart.data.datasets;
      eigSet.data = eig.map((p) => ({ x: p.re, y: p.im }));
      circleSet.data = circle;
      poleSet.data = poles.map((p) => ({ x: p.re, y: p.im }));
      refSet.hidden = !ref;
      refSet.data = refPoles.map((p) => ({ x: p.re, y: p.im }));
      sChart.options.scales.x.min = centreX - side / 2;
      sChart.options.scales.x.max = centreX + side / 2;
      sChart.options.scales.y.min = -side / 2;
      sChart.options.scales.y.max = side / 2;
      sChart.update('none');

      const pairText = (list) => Math.abs(list[0].im) > 5e-7
        ? `${fmt(list[0].re, 3)} \u00b1 j${fmt(Math.abs(list[0].im), 3)}`
        : list.map((p) => fmt(p.re, 3)).join(' and ');
      const sameNumbers = poleGap(eig, poles) < 1e-6;
      ui.sEig.textContent = `Eigenvalues of A (rings): ${pairText(eig)}. Poles of G(s) (crosses): ${pairText(poles)}. ` +
        (sameNumbers ? 'They are the same numbers.' : 'They differ.');

      const legend = [
        { label: 'Poles of G(s)', kind: 'cross', color: THEME.output },
        { label: 'Eigenvalues of A', kind: 'ring', color: THEME.tau },
        { label: 'Circle |s| = \u03c9n', kind: 'dashed', color: THEME.reference }
      ];
      if (kind === 'under') legend.push({ label: 'Lines at angle \u03b8 from the real axis', kind: 'dashed', color: THEME.error });
      if (ref) legend.push({ label: 'Pinned poles', kind: 'cross', color: THEME.reference });
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
    document.getElementById('m3-root').querySelectorAll('.preset-list [data-zeta]').forEach((btn) => btn.addEventListener('click', () => {
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
  })();
  
}
if (page === "model4") {

  /* =========================================================================
     MODULE 4: GUESS THE SENSOR
     Wrapped in its own function so its names cannot clash with other modules.
     ========================================================================= */
  (function () {

    // ENCS4380 - Module 4: Guess the Sensor
    // Pure browser-side implementation with a dependency-free SVG chart.
    const $ = id => document.getElementById('m4-' + id);   // every Module 4 id starts with m4-
    const rand = (lo, hi) => lo + Math.random() * (hi-lo);
    const roundTo = (v, digits=2) => Number(v.toFixed(digits));
    let active = null;
    let checkedRounds = 0, perfectRounds = 0, totalPoints = 0;

    function firstStep(t, K, tau) { return K*(1-Math.exp(-t/tau)); }
    function firstSine(t, K, tau, omega) {
      const magnitude = K/Math.sqrt(1+(omega*tau)**2);
      return magnitude*Math.sin(omega*t-Math.atan(omega*tau));
    }
    function secondStep(t, z, wn) {
      if (z < 1 - 1e-8) {
        const wd = wn*Math.sqrt(1-z*z);
        return 1-Math.exp(-z*wn*t)*(Math.cos(wd*t) + z/Math.sqrt(1-z*z)*Math.sin(wd*t));
      }
      if (Math.abs(z-1) < 1e-8) return 1-(1+wn*t)*Math.exp(-wn*t);
      const r = Math.sqrt(z*z-1);
      const p1 = -wn*(z-r), p2 = -wn*(z+r);
      return 1 - (p2*Math.exp(p1*t)-p1*Math.exp(p2*t))/(p2-p1);
    }
    function predict(t, par, current=active) {
      if (current.kind === 'step1') return firstStep(t,par.K,par.tau);
      if (current.kind === 'sine1') return firstSine(t,par.K,par.tau,current.omega);
      return secondStep(t,par.zeta,par.wn);
    }
    function drawFallbackPlot(target, traces) {
      const compact=window.matchMedia('(max-width: 600px)').matches;
      const width=Math.max(240,target.clientWidth);
      const height=target.clientHeight||330;
      const columns=compact?1:traces.length;
      const legendRows=Math.ceil(traces.length/columns);
      const margin={top:14,right:compact?8:18,bottom:42+legendRows*17,left:compact?42:54};
      const plotWidth=width-margin.left-margin.right;
      const plotHeight=height-margin.top-margin.bottom;
      const allX=[],allY=[];
      traces.forEach(trace=>{
        allX.push(...trace.x);
        allY.push(...trace.y);
      });
      const xMin=Math.min(0,...allX),xMax=Math.max(...allX);
      let yMin=Math.min(...allY),yMax=Math.max(...allY);
      const yPadding=(yMax-yMin||1)*.06;
      yMin-=yPadding;yMax+=yPadding;
      const xPos=value=>margin.left+(value-xMin)/(xMax-xMin||1)*plotWidth;
      const yPos=value=>margin.top+(yMax-value)/(yMax-yMin)*plotHeight;
      const canvas=document.createElement('canvas');
      const scale=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.round(width*scale);
      canvas.height=Math.round(height*scale);
      canvas.style.width='100%';
      canvas.style.height='100%';
      canvas.setAttribute('role','img');
      canvas.setAttribute('aria-label','Sensor response graph');
      const context=canvas.getContext('2d');
      if(!context) {
        target.textContent='The response graph is unavailable in this browser.';
        return;
      }
      context.scale(scale,scale);
      context.font=`${compact?10:11}px system-ui, sans-serif`;
      context.lineWidth=1;
      context.fillStyle='white';
      context.fillRect(0,0,width,height);

      for(let i=0;i<=4;i++) {
        const x=margin.left+plotWidth*i/4;
        const value=xMin+(xMax-xMin)*i/4;
        context.beginPath();
        context.moveTo(x,margin.top);
        context.lineTo(x,margin.top+plotHeight);
        context.strokeStyle='#e6ebf1';
        context.stroke();
        context.textAlign='center';
        context.fillStyle='#475569';
        context.fillText(Number(value.toPrecision(2)).toString(),x,margin.top+plotHeight+15);
      }
      for(let i=0;i<=4;i++) {
        const y=margin.top+plotHeight*i/4;
        const raw=yMax-(yMax-yMin)*i/4;
        const value=Math.abs(raw)<(yMax-yMin)*1e-3?0:raw;   // show a near-zero tick as 0, not 0.00031
        context.beginPath();
        context.moveTo(margin.left,y);
        context.lineTo(margin.left+plotWidth,y);
        context.strokeStyle='#e6ebf1';
        context.stroke();
        context.textAlign='right';
        context.fillStyle='#475569';
        context.fillText(Number(value.toPrecision(2)).toString(),margin.left-7,y+4);
      }
      context.textAlign='center';
      context.fillStyle='#475569';
      context.fillText('Time (s)',margin.left+plotWidth/2,height-legendRows*17-19);
      context.save();
      context.translate(13,margin.top+plotHeight/2);
      context.rotate(-Math.PI/2);
      context.fillText('Output',0,0);
      context.restore();

      traces.forEach((trace,index)=>{
        const line=trace.line||{},marker=trace.marker||{};
        const color=line.color||marker.color||'#007c83';
        if(trace.mode==='lines') {
          context.beginPath();
          trace.x.forEach((x,i)=>{
            if(i===0)context.moveTo(xPos(x),yPos(trace.y[i]));
            else context.lineTo(xPos(x),yPos(trace.y[i]));
          });
          context.strokeStyle=color;
          context.lineWidth=line.width||2;
          context.setLineDash(line.dash==='dash'?[7,5]:line.dash==='dot'?[2,4]:[]);
          context.stroke();
          context.setLineDash([]);
        }
        if(trace.mode==='markers') {
          context.fillStyle=color;
          context.globalAlpha=marker.opacity||1;
          trace.x.forEach((x,i)=>{
            context.beginPath();
            context.arc(xPos(x),yPos(trace.y[i]),compact?2.1:2.5,0,Math.PI*2);
            context.fill();
          });
          context.globalAlpha=1;
        }
        const col=index%columns,row=Math.floor(index/columns);
        const itemX=margin.left+col*(plotWidth/columns);
        const itemY=height-legendRows*17+row*17+5;
        if(trace.mode==='lines') {
          context.beginPath();
          context.moveTo(itemX,itemY-3);
          context.lineTo(itemX+15,itemY-3);
          context.strokeStyle=color;
          context.lineWidth=2;
          context.setLineDash(line.dash==='dash'?[7,5]:line.dash==='dot'?[2,4]:[]);
          context.stroke();
          context.setLineDash([]);
        } else {
          context.beginPath();
          context.arc(itemX+7,itemY-3,2.5,0,Math.PI*2);
          context.fillStyle=color;
          context.fill();
        }
        context.textAlign='left';
        context.fillStyle='#475569';
        context.fillText(trace.name,itemX+20,itemY);
      });
      while(target.firstChild)target.removeChild(target.firstChild);
      target.appendChild(canvas);
    }

    function plot(guess=null) {
      const c=active;
      const t=Array.from({length:301},(_,i)=>c.duration*i/300);
      const traces=[];
      if(c.kind==='sine1') traces.push({x:t,y:t.map(x=>Math.sin(c.omega*x)),mode:'lines',name:'Known sine input',line:{color:'#94a3b8',dash:'dash'}});
      if(c.kind==='step1') traces.push({x:t,y:t.map(()=>1),mode:'lines',name:'Known unit step',line:{color:'#94a3b8',dash:'dash'}});
      traces.push({x:c.sampleT,y:c.samples,mode:'markers',name:'Noisy sensor samples',marker:{color:'#0f766e',size:5,opacity:.8}});
      if(guess) {
        traces.push({x:t,y:t.map(x=>predict(x,guess)),mode:'lines',name:'Your guessed model',line:{color:'#e88c30',width:3}});
        traces.push({x:t,y:t.map(x=>predict(x,c.params)),mode:'lines',name:'True model',line:{color:'#7c3aed',width:2,dash:'dot'}});
      }
      lastTraces=traces;
      drawFallbackPlot($('responsePlot'),traces);
    }
    function newSensor() {
      const kinds=['step1','sine1','second'];
      const kind=kinds[Math.floor(Math.random()*kinds.length)];
      let params,duration,omega=null,noise;
      if(kind==='step1') {
        params={K:roundTo(rand(.7,2.5)),tau:roundTo(rand(.35,2.3))};
        duration=roundTo(5*params.tau);noise=.025*params.K;
      } else if(kind==='sine1') {
        params={K:roundTo(rand(.8,2)),tau:roundTo(rand(.2,1.1))};
        omega=roundTo(rand(1.3,3.5));duration=roundTo(Math.max(8,5*2*Math.PI/omega));
        noise=.025*params.K;
      } else {
        // Underdamped only: the homework's method (overshoot gives zeta, peak time gives wn) needs a visible
        // peak, and zeta <= 0.6 keeps the overshoot (9.5% or more) well above the +-0.02 noise.
        const zeta=roundTo(rand(.2,.6));
        params={zeta,wn:roundTo(rand(1,3.3))};
        duration=roundTo(12/params.wn);noise=.02;
      }
      const sampleT=Array.from({length:91},(_,i)=>duration*i/90);
      const context={kind,params,duration,omega};
      const samples=sampleT.map(t=>predict(t,params,context)+rand(-noise,noise));
      active={...context,sampleT,samples,solved:false};
      $('result').hidden=true;$('hintText').hidden=true;
      $('checkBtn').disabled=false;
      let fields,question,hint,roundName,roundHint;
      if(kind==='step1') {
        roundName='Unknown first-order sensor • Unit step';
        roundHint='Input jumps from 0 to 1 at t = 0.';
        question='Estimate gain K and time constant τ from the response curve.';
        hint='Estimate K from the final plateau. Find where the curve reaches 63.2% of that plateau; that time is τ.';
        fields=[['K','Gain K',''],['tau','Time constant τ','s']];
      } else if(kind==='sine1') {
        roundName='Unknown first-order sensor • Sine input';
        roundHint=`Known input: sin(${omega}t), so ω = ${omega} rad/s. Output is the steady-state sinusoid.`;
        question='Estimate K and τ from amplitude attenuation and phase lag relative to the dashed input.';
        hint='Compare output amplitude and input amplitude, and measure the time shift Δt: |φ| = ωΔt. Then τ = tan(|φ|)/ω and K = M√(1+(ωτ)²).';
        fields=[['K','Gain K',''],['tau','Time constant τ','s']];
      } else {
        roundName='Unknown second-order sensor • Unit step';
        roundHint='The response is normalized to a final value of 1.';
        question='Estimate damping ratio ζ and natural frequency ωn from the overshoot and the peak time.';
        hint='Overshoot depends only on ζ: read OS from the highest point above 1, then ζ = −ln(OS)/√(π² + ln²(OS)). Peak time depends on ζ and ωn: ωn = π/(tp√(1 − ζ²)).';
        fields=[['zeta','Damping ratio ζ',''],['wn','Natural frequency ωn','rad/s']];
      }
      $('roundName').textContent=roundName;$('roundHint').textContent=roundHint;
      $('question').textContent=question;$('hintText').textContent=hint;
      $('fields').innerHTML=fields.map(([id,label,unit])=>`<div class="field"><label for="m4-${id}">${label}${unit?` (${unit})`:''}</label><input type="number" id="m4-${id}" name="${id}" min="0.001" step="any" required placeholder="Your estimate" /></div>`).join('');
      plot();
    }
    function checkGuess(e) {
      e.preventDefault();
      if(!active||active.solved) return;
      const names=Object.keys(active.params);
      const guess={};
      for(const key of names){const input=$(key);const v=Number(input.value);if(!input.value.trim()||!Number.isFinite(v)||v<=0){input.reportValidity();return;}guess[key]=v;}
      const errors=names.map(key=>Math.abs(guess[key]-active.params[key])/active.params[key]);
      const passed=errors.every(err=>err<=.1);
      const score=errors.reduce((sum,err)=>sum+(err<=.1?5:0),0);
      checkedRounds++;totalPoints+=score;if(passed)perfectRounds++;
      $('rounds').textContent=checkedRounds;$('perfect').textContent=perfectRounds;
      $('total').textContent=`${totalPoints} / ${checkedRounds*10}`;
      const labels={K:'K',tau:'τ',zeta:'ζ',wn:'ωn'};
      const rows=names.map((key,i)=>`<tr><td>${labels[key]}</td><td>${guess[key].toFixed(3)}</td><td>${active.params[key].toFixed(3)}</td><td>${(errors[i]*100).toFixed(1)}%</td><td>${errors[i]<=.1?'PASS':'TRY AGAIN NEXT ROUND'}</td></tr>`).join('');
      $('result').innerHTML=`<h3>${passed?'Excellent! All parameters within 10%.':'Results revealed'} — ${score}/10 points</h3><table><thead><tr><th>Parameter</th><th>Your guess</th><th>True value</th><th>Error</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table><p>Orange line = your guess; purple dotted line = true model. Click <strong>New sensor</strong> to continue.</p>`;
      $('result').hidden=false;$('checkBtn').disabled=true;active.solved=true;
      plot(guess);
    }
    $('guessForm').addEventListener('submit',checkGuess);
    $('newBtn').addEventListener('click',newSensor);
    $('hintBtn').addEventListener('click',()=>{$('hintText').hidden=!$('hintText').hidden;});
    let lastTraces=[];
    const responsePlot=$('responsePlot');
    if('ResizeObserver' in window) {
      new ResizeObserver(()=>{
        if(lastTraces.length)drawFallbackPlot(responsePlot,lastTraces);
      }).observe(responsePlot);
    }
    newSensor();
  })();
  
}
return;
}
if (document.documentElement.dataset.homework === "2") {
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
if (page === "p1") {



  /* =========================================================================
     CONTROL P1: PID PLAYGROUND (user interface)
     Reads the controls, runs PidEngine.simulate(), draws the two charts,
     fills the metrics and runs the validation tests.
     ========================================================================= */
  function initP1() {
    const DEFAULTS = Object.freeze({
      plant: 'first', K: 1, tau: 1, zeta: 0.5, wn: 2,
      Kp: 9, Ki: 0, Kd: 0, dMode: 'error', r: 1, uMax: 10, uMin: -10, window: 'auto'
    });
    // Presets are tuned for the default plant of each type (they keep the current K, τ, ζ, ω_n).
    const PRESETS = {
      first:  { P: { Kp: 9, Ki: 0, Kd: 0 }, PI: { Kp: 9, Ki: 20, Kd: 0 }, PID: { Kp: 9, Ki: 20, Kd: 0.1 } },
      second: { P: { Kp: 5, Ki: 0, Kd: 0 }, PI: { Kp: 5, Ki: 5, Kd: 0 }, PID: { Kp: 5, Ki: 5, Kd: 1 } }
    };
    const PRESET_HELP = {
      first: 'P = 9 → PI = 9 / 20 → PID = 9 / 20 / 0.1. Start with P, then add I, then D.',
      second: 'P = 5 → PI = 5 / 5 → PID = 5 / 5 / 1. Watch D damp the overshoot.'
    };

    const state = Object.assign({}, DEFAULTS, { reference: null });
    const $ = (id) => document.getElementById(id);

    // Sliders: state key → element id and readout format
    const SLIDERS = {
      K:    { id: 'p1-K',    text: (v) => v.toFixed(1) },
      tau:  { id: 'p1-tau',  text: (v) => `${v.toFixed(1)} s` },
      zeta: { id: 'p1-zeta', text: (v) => v.toFixed(2) },
      wn:   { id: 'p1-wn',   text: (v) => `${v.toFixed(1)} rad/s` },
      Kp:   { id: 'p1-kp',   text: (v) => v.toFixed(1) },
      Ki:   { id: 'p1-ki',   text: (v) => `${v.toFixed(1)} s⁻¹` },
      Kd:   { id: 'p1-kd',   text: (v) => `${v.toFixed(2)} s` },
      r:    { id: 'p1-r',    text: (v) => v.toFixed(1) },
      uMax: { id: 'p1-umax', text: (v) => fmt(v, 1) },
      uMin: { id: 'p1-umin', text: (v) => fmt(v, 1) }
    };
    Object.values(SLIDERS).forEach((s) => { s.el = $(s.id); s.out = $(s.id + '-value'); });

    const ui = {
      plantRadios: document.querySelectorAll('input[name="p1-plant"]'),
      plantFirst: document.querySelectorAll('[data-plant="first"]'),
      plantSecond: document.querySelectorAll('[data-plant="second"]'),
      presets: document.querySelectorAll('[data-preset]'), presetHelp: $('p1-preset-help'),
      reset: $('p1-reset'), inputError: $('p1-input-error'),
      bd: $('p1-bd'), paramChip: $('p1-param-chip'),
      yLegend: $('p1-y-legend'), yCanvas: $('p1-y-chart'),
      uLegend: $('p1-u-legend'), uCanvas: $('p1-u-chart'), satChip: $('p1-sat-chip'), uNote: $('p1-u-note'),
      pin: $('p1-pin'), unpin: $('p1-unpin'), refStatus: $('p1-ref-status'),
      status: $('p1-status'), satCallout: $('p1-sat-callout'), satText: $('p1-sat-text'),
      validationBody: $('p1-validation-body'), validationSummary: $('p1-validation-summary')
    };

    let yChart = null;
    let uChart = null;
    let yGuides = null;
    let uGuides = null;
    let refCache = { key: '', result: null, metrics: null };

    /* ---------- Predict, then check ---------- */
    const QUESTIONS = [
      {
        setup: { plant: 'first', K: 1, tau: 1, Kp: 9, Ki: 0, Kd: 0, r: 1, uMax: 10, uMin: -10 },
        prompt: 'K = 1, τ = 1 s, P only with Kp = 9: the output settles 10% short of the setpoint. What happens to the steady-state error if Kp is raised to 19?',
        choices: [
          { text: 'It disappears.', correct: false },
          { text: 'It halves, to about 5%.', correct: true },
          { text: 'It stays at 10%; only the speed changes.', correct: false }
        ],
        explanation: 'e_ss = 1/(1 + K·Kp): 1/10 = 10% becomes 1/20 = 5%. With more gain, a smaller error produces the same u, but some error must remain, because a P controller only pushes while e ≠ 0. The loop also gets faster: τ_cl = τ/(1 + K·Kp) = 0.05 s.',
        tryIt: 'The Kp = 9 response is now pinned as the dotted reference. Drag Kp to 19: the final value rises from 0.90 to 0.95. Look at u(t): at t = 0 the PID asks for 19 but the limit is 10, so the first instant is clipped (red shading).'
      },
      {
        setup: { plant: 'first', K: 1, tau: 1, Kp: 3, Ki: 0, Kd: 0, r: 1, uMax: 10, uMin: -10 },
        prompt: 'P only with Kp = 3 leaves a 25% error. You add integral action, Ki = 10. What happens?',
        choices: [
          { text: 'The error goes to zero, but the response now overshoots.', correct: true },
          { text: 'The error goes to zero and the shape of the response stays the same.', correct: false },
          { text: 'The error shrinks to about 10% but never reaches zero.', correct: false }
        ],
        explanation: 'The integral keeps growing while any error remains, so the loop can only come to rest at e = 0. It also adds a pole: the closed loop becomes second order, τs² + (1 + KKp)s + KKi = 0, with ζ = 4 / (2√10) ≈ 0.63 here, so it overshoots by about 15%.',
        tryIt: 'Kp = 3 (P only) is pinned. Set Ki to 10 and compare: the steady-state error card drops to 0.000 and the overshoot card shows about 15%.'
      },
      {
        setup: { plant: 'second', K: 1, zeta: 0.5, wn: 2, Kp: 5, Ki: 5, Kd: 0, r: 1, uMax: 10, uMin: -10 },
        prompt: 'Second-order plant (ζ = 0.5, ω_n = 2 rad/s) with PI, Kp = 5 and Ki = 5: it overshoots by about 52%. What will raising Kd to 1 do?',
        choices: [
          { text: 'Cut the overshoot sharply (to roughly 12%) and settle sooner.', correct: true },
          { text: 'Remove the steady-state error.', correct: false },
          { text: 'Increase the overshoot, because the controller reacts faster.', correct: false }
        ],
        explanation: 'This plant has inertia: when y reaches the setpoint it is still moving fast. The D term sees e falling quickly and reduces u early, like a brake. In the characteristic equation it adds K·Kd·ω_n² to the s term, which is extra damping. The steady-state error was already zero thanks to Ki.',
        tryIt: 'The PI response is pinned. Raise Kd to 1: overshoot falls to about 12% and settling drops from about 6.7 s to 1.3 s.'
      }
    ];

    /* ---------- Model configuration from the controls ---------- */
    function plantConfig(s) {
      return s.plant === 'first'
        ? { type: 'first', K: s.K, tau: s.tau }
        : { type: 'second', K: s.K, zeta: s.zeta, wn: s.wn };
    }
    function loopConfig(s) {
      return { plant: plantConfig(s), Kp: s.Kp, Ki: s.Ki, Kd: s.Kd, dMode: s.dMode, r: s.r, uMin: s.uMin, uMax: s.uMax };
    }
    function plantText(s) {
      return s.plant === 'first'
        ? `K = ${s.K.toFixed(1)}, τ = ${s.tau.toFixed(1)} s`
        : `K = ${s.K.toFixed(1)}, ζ = ${s.zeta.toFixed(2)}, ω_n = ${s.wn.toFixed(1)} rad/s`;
    }
    function gainsText(s) {
      return `Kp ${fmtGain(s.Kp)} · Ki ${fmtGain(s.Ki)} · Kd ${fmtGain(s.Kd)}`;
    }
    function fmtGain(v) { return String(Number(v.toFixed(2))); }
    function referenceText(ref) {
      return `${ref.plant === 'first' ? 'first order' : 'second order'}, ${gainsText(ref)}, r = ${ref.r.toFixed(1)}`;
    }

    /* ---------- Charts ---------- */
    function baseOptions() {
      return {
        responsive: true, maintainAspectRatio: false, animation: false,
        parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 6, hoverBorderWidth: 2 } },
        layout: { padding: { top: 6, right: 10 } }
      };
    }
    function lineSet(role, label, color, extra) {
      return Object.assign({ role, label, data: [], borderColor: color, backgroundColor: color,
        pointHoverBackgroundColor: '#fff', borderWidth: 2, tension: 0 }, extra);
    }

    function createCharts() {
      if (!CHARTS_AVAILABLE) {
        document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = false; });
        return;
      }
      applyChartDefaults();
      const tooltip = (unit) => Object.assign(tooltipStyle(), {
        callbacks: {
          title: (items) => (items.length ? `t = ${fmt(items[0].parsed.x, 3)} s` : ''),
          label: (item) => ` ${item.dataset.label}: ${fmt(item.parsed.y, 3)}${unit}`
        }
      });
      yChart = new Chart(ui.yCanvas, {
        type: 'line',
        data: { datasets: [
          lineSet('setpoint', 'Setpoint r(t)', THEME.setpoint, { borderWidth: 1.75, borderDash: [6, 5], order: 2 }),
          lineSet('output', 'Output y(t)', THEME.output, { borderWidth: 2.75, order: 0 }),
          lineSet('reference', 'Reference y(t)', THEME.reference, { borderDash: [2, 3], order: 3, hidden: true })
        ] },
        options: Object.assign(baseOptions(), {
          scales: {
            x: ControlKit.timeAxis(),
            y: { title: { display: true, text: 'Output y(t)', font: { weight: '600' } },
                 grid: { color: THEME.grid }, border: { color: THEME.axis } }
          },
          plugins: { legend: { display: false }, tooltip: tooltip('') }
        }),
        plugins: [createGuidesPlugin(() => yGuides)]
      });
      uChart = new Chart(ui.uCanvas, {
        type: 'line',
        data: { datasets: [
          lineSet('u', 'Control u(t)', THEME.control, { borderWidth: 2.5, order: 0 })
        ] },
        options: Object.assign(baseOptions(), {
          scales: {
            x: ControlKit.timeAxis(),
            y: { title: { display: true, text: 'Control u(t)', font: { weight: '600' } },
                 grid: { color: THEME.grid }, border: { color: THEME.axis } }
          },
          plugins: { legend: { display: false }, tooltip: tooltip('') }
        }),
        plugins: [createGuidesPlugin(() => uGuides)]
      });
    }

    /** Teaching marks on the response chart: ±2 % band, t_r, M_p, t_s and the e_ss bracket. */
    function responseGuides(met, r, W, yRange) {
      const g = { lines: [], segments: [], markers: [], labels: [] };
      if (met.status !== 'ok') return g;
      const yss = met.yss;
      const band = PidEngine.SETTLE_BAND * Math.abs(yss);
      const bandColor = hexToRgba(THEME.output, 0.45);
      g.lines.push({ x1: 0, y1: yss + band, x2: W, y2: yss + band, color: bandColor, dash: [4, 4] });
      g.lines.push({ x1: 0, y1: yss - band, x2: W, y2: yss - band, color: bandColor, dash: [4, 4] });
      if (met.ts > 0 && met.ts <= W) {
        g.lines.push({ x1: met.ts, y1: yRange[0], x2: met.ts, y2: yRange[1], color: hexToRgba(THEME.tau3, 0.6), dash: [3, 4] });
        g.labels.push({ x: met.ts, y: yRange[0], dx: 6, dy: -14, text: `t_s = ${fmt(met.ts, 3)} s`, short: `t_s ${fmt(met.ts, 2)}`, color: THEME.tau3 });
      }
      if (Number.isFinite(met.t10) && met.t90 <= W) {
        g.markers.push({ x: met.t10, y: 0.1 * yss, color: THEME.tau, radius: 4.5 });
        g.markers.push({ x: met.t90, y: 0.9 * yss, color: THEME.tau, radius: 4.5 });
        g.labels.push({ x: met.t90, y: 0.9 * yss, dx: 10, dy: 14, text: `t_r = ${fmt(met.tr, 3)} s (10→90%)`, short: `t_r ${fmt(met.tr, 2)} s`, color: THEME.tau });
      }
      if (met.mp > 0.05 && met.tPeak <= W) {
        g.markers.push({ x: met.tPeak, y: met.yPeak, color: THEME.error });
        g.labels.push({ x: met.tPeak, y: met.yPeak, dx: 10, dy: -12, text: `M_p = ${fmt(met.mp, 1)}%`, color: THEME.errorText });
      }
      if (Math.abs(met.ess) > 1e-3 * Math.abs(r)) {
        g.lines.push({ x1: 0, y1: yss, x2: W, y2: yss, color: hexToRgba(THEME.error, 0.8), dash: [6, 4] });
        const xb = 0.93 * W;
        g.segments.push({ x1: xb, y1: yss, x2: xb, y2: r, color: THEME.error, width: 2.5, caps: true });
        g.labels.push({ x: xb, y: (yss + r) / 2, dx: -8, align: 'right',
          text: `e_ss = ${fmt(met.ess, 3)} (${fmt(met.essPct, 1)}%)`, short: `e_ss ${fmt(met.essPct, 1)}%`, color: THEME.errorText });
      }
      return g;
    }

    /* ---------- Simulation helpers ---------- */
    function runLoop(s, W) {
      const cfg = loopConfig(s);
      let result = PidEngine.simulate(cfg);
      let met = PidEngine.metrics(result);
      let window = W === 'auto' ? ControlKit.autoWindow(result, met) : Number(W);
      if (window > result.horizon + 1e-9 && !result.diverged) {
        result = PidEngine.simulate(cfg, { horizon: window });   // longer run so the chosen window is filled
        met = PidEngine.metrics(result);
        if (W === 'auto') window = ControlKit.autoWindow(result, met);
      }
      return { result, met, window: Math.min(window, result.horizon) || window };
    }

    function referenceRun(W) {
      const ref = state.reference;
      if (!ref) return null;
      const key = JSON.stringify(ref) + '|' + W;
      if (refCache.key !== key) {
        const cfg = loopConfig(ref);
        let result = PidEngine.simulate(cfg, { minHorizon: W });
        refCache = { key, result, metrics: PidEngine.metrics(result) };
      }
      return refCache;
    }

    /* ---------- Render everything from the current state ---------- */
    function render() {
      let run;
      try {
        run = runLoop(state, state.window);
        ui.inputError.hidden = true;
      } catch (error) {
        ui.inputError.textContent = error.message;
        ui.inputError.hidden = false;
        return;
      }
      const { result, met } = run;
      const W = run.window;
      const rec = result.rec;
      const r = state.r;
      const ok = met.status === 'ok';
      const ref = referenceRun(W);

      // Block diagram and chips
      ControlKit.setDiagramText(ui.bd, 'gains', gainsText(state));
      ControlKit.setDiagramText(ui.bd, 'limits', `limits ${fmt(state.uMin, 1)} … ${fmt(state.uMax, 1)}`);
      ControlKit.setDiagramText(ui.bd, 'plant-name', state.plant === 'first' ? 'First-order plant' : 'Second-order plant');
      ControlKit.setDiagramText(ui.bd, 'plant-tf', state.plant === 'first'
        ? `G(s) = ${fmtGain(state.K)} / (${fmtGain(state.tau)}s + 1)`
        : `G(s) = ${fmtGain(state.K * state.wn * state.wn)} / (s² + ${fmtGain(2 * state.zeta * state.wn)}s + ${fmtGain(state.wn * state.wn)})`);
      ui.paramChip.textContent = `${plantText(state)}, r = ${r.toFixed(1)}`;

      // Response chart
      const [ylo, yhi] = ControlKit.extent(rec, 'y', W);
      const values = [0, r, ylo, yhi];
      if (ref) { const [a, b] = ControlKit.extent(ref.result.rec, 'y', W); values.push(a, b); }
      const clip = ok || met.status === 'not-settled' ? null : [-2 * Math.abs(r), 3 * Math.abs(r)];
      const yRange = ControlKit.valueRange(values, clip);
      const yLegend = [
        { label: 'Setpoint r(t)', kind: 'dashed', color: THEME.setpoint },
        { label: 'Output y(t)', kind: 'line', color: THEME.output }
      ];
      if (ok) {
        yLegend.push({ label: '±2% band', kind: 'dashed', color: hexToRgba(THEME.output, 0.45) });
        yLegend.push({ label: '10% and 90% points', kind: 'dot', color: THEME.tau });
        if (met.mp > 0.05) yLegend.push({ label: 'Peak (overshoot)', kind: 'dot', color: THEME.error });
        if (Math.abs(met.ess) > 1e-3 * Math.abs(r)) yLegend.push({ label: 'Steady-state error', kind: 'vbar', color: THEME.error });
      }
      if (ref) yLegend.push({ label: `Reference (${referenceText(state.reference)})`, kind: 'dotted', color: THEME.reference });
      renderLegend(ui.yLegend, yLegend);
      if (yChart) {
        const [sp, out, refSet] = yChart.data.datasets;
        sp.data = [{ x: 0, y: r }, { x: W, y: r }];
        out.data = PidEngine.decimate(rec, 'y', 0, W, 500);
        refSet.hidden = !ref;
        refSet.data = ref ? PidEngine.decimate(ref.result.rec, 'y', 0, W, 400) : [];
        refSet.label = 'Reference y(t)';
        yChart.options.scales.x.max = W;
        yChart.options.scales.y.min = yRange[0];
        yChart.options.scales.y.max = yRange[1];
        yGuides = responseGuides(met, r, W, yRange);
        yChart.update('none');
      }

      // Control-signal chart
      const uVals = ControlKit.extent(rec, 'u', W);
      uVals.push(0);
      const span = Math.max(Math.max(...uVals) - Math.min(...uVals), 1e-6);
      const showMax = state.uMax <= Math.max(...uVals) + 1.5 * span;
      const showMin = state.uMin >= Math.min(...uVals) - 1.5 * span;
      if (showMax) uVals.push(state.uMax);
      if (showMin) uVals.push(state.uMin);
      const uRange = ControlKit.valueRange(uVals);
      const spans = ControlKit.saturationSpans(rec, W);
      const uLegend = [{ label: 'Control signal u(t) (after the limit)', kind: 'line', color: THEME.control },
                       { label: 'Limits u_min, u_max', kind: 'dashed', color: THEME.limit }];
      renderLegend(ui.uLegend, uLegend);
      if (uChart) {
        const sets = uChart.data.datasets;
        sets[0].data = PidEngine.decimate(rec, 'u', 0, W, 500);
        uChart.options.scales.x.max = W;
        uChart.options.scales.y.min = uRange[0];
        uChart.options.scales.y.max = uRange[1];
        const limColor = hexToRgba(THEME.limit, 0.85);
        uGuides = { spans, lines: [], labels: [] };
        if (showMax) {
          uGuides.lines.push({ x1: 0, y1: state.uMax, x2: W, y2: state.uMax, color: limColor, dash: [6, 4], width: 1.5 });
          uGuides.labels.push({ x: W, y: state.uMax, dx: -4, dy: -12, align: 'right', text: `u_max = ${fmt(state.uMax, 1)}`, color: THEME.limit });
        }
        if (showMin) {
          uGuides.lines.push({ x1: 0, y1: state.uMin, x2: W, y2: state.uMin, color: limColor, dash: [6, 4], width: 1.5 });
          uGuides.labels.push({ x: W, y: state.uMin, dx: -4, dy: 12, align: 'right', text: `u_min = ${fmt(state.uMin, 1)}`, color: THEME.limit });
        }
        uChart.update('none');
      }
      const hidden = [!showMax && `u_max = ${fmt(state.uMax, 1)}`, !showMin && `u_min = ${fmt(state.uMin, 1)}`].filter(Boolean);
      ui.uNote.textContent = hidden.length ? `${hidden.join(' and ')} ${hidden.length > 1 ? 'are' : 'is'} far outside this view, so not drawn.` : 'Red shading marks the time u is held at a limit.';
      ui.satChip.textContent = met.satTime > 0 ? `Saturated for ${fmt(met.satTime, 3)} s` : 'Not saturated';
      ui.satChip.className = 'chip ' + (met.satTime > 0 ? 'chip--fail' : 'chip--pass');

      // Status, metrics, reference values
      renderStatus(met, result);
      const set = (id, text, na) => { const el = $(id); el.textContent = text; el.parentElement.classList.toggle('is-na', na); };
      set('p1-m-tr', ControlKit.metricText(met.tr, 3), !ok);
      set('p1-m-mp', ControlKit.metricText(met.mp, 1), !ok);
      set('p1-m-ts', ControlKit.metricText(met.ts, 3), !ok);
      set('p1-m-ess', ControlKit.metricText(met.ess, 3), !ok);
      $('p1-m-ess-pct').textContent = ok ? `(${fmt(met.essPct, 1)}%)` : '';

      lastRec = rec;
      renderSaturation(met);

      // Reference controls
      const same = state.reference && JSON.stringify(loopConfig(state.reference)) === JSON.stringify(loopConfig(state));
      ui.refStatus.textContent = !state.reference
        ? 'No reference curve. Pin the current curve to compare later settings with it.'
        : same ? 'Reference pinned (identical to the live curve). Change a control to compare.'
          : `Dotted reference: ${referenceText(state.reference)}.`;
      ui.pin.disabled = Boolean(same);
      ui.unpin.disabled = !state.reference;

      // Screen-reader descriptions
      ui.yCanvas.setAttribute('aria-label', ok
        ? `Closed-loop step response: y rises to ${fmt(met.yss, 3)} for a setpoint of ${fmt(r, 2)}, rise time ${fmt(met.tr, 3)} s, overshoot ${fmt(met.mp, 1)} percent, settling time ${fmt(met.ts, 3)} s.`
        : `Closed-loop step response: ${met.reason}`);
      ui.uCanvas.setAttribute('aria-label', `Control signal: peak magnitude ${fmt(met.peakU, 2)}, saturated for ${fmt(met.satTime, 3)} s.`);
    }

    function renderStatus(met, result) {
      const bad = ControlKit.statusSentence(met);
      if (!bad) {
        ui.status.className = 'status-line status-line--ok';
        ui.status.innerHTML = `<strong>Stable and settled.</strong><span>y<sub>final</sub> = ${escapeHtml(fmt(met.yss, 4))}; y stays within ±2% of it after t = ${escapeHtml(fmt(met.ts, 3))} s. Run length ${escapeHtml(fmt(result.horizon, 1))} s.</span>`;
        return;
      }
      ui.status.className = 'status-line status-line--' + bad.cls;
      ui.status.innerHTML = `<strong>${escapeHtml(bad.title)}</strong><span>${escapeHtml(bad.text)}</span>`;
    }

    /** Short explanation whenever u is held at a limit. */
    function renderSaturation(met) {
      if (!(met.satTime > 0)) { ui.satCallout.hidden = true; return; }
      ui.satCallout.hidden = false;
      if (met.status === 'oscillating' || met.status === 'unstable') {
        ui.satText.textContent = `u hits a limit for ${fmt(met.satTime, 3)} s. The loop itself is unstable: the limits only stop the swings from growing. Lower the gains.`;
      } else if (state.Kd > 0 && met.satTime < 10 * PidEngine.DERIV_TF && result0Sat()) {
        ui.satText.textContent = `Derivative kick: the setpoint step makes de/dt very large for an instant, and the limit clips it for ${fmt(met.satTime, 3)} s. It barely changes y.`;
      } else {
        ui.satText.textContent = `u is held at a limit for ${fmt(met.satTime, 3)} s, so the plant receives less than the PID asks for. The output rises more slowly than the formulas predict${state.Ki > 0 ? ', and the integral winds up, which adds overshoot' : ''}.`;
      }
    }
    let lastRec = null;
    function result0Sat() { return lastRec && lastRec.sat.findIndex(Boolean) <= 2; }

    /* ---------- Validation: the three Homework 2 tests ----------
       Every "calculated" value is measured from PidEngine.simulate(), the same
       RK4 simulation that draws the charts. Nothing is hard-coded as PASS. */
    function runValidation() {
      const base = { plant: { type: 'first', K: 1, tau: 1 }, r: 1, uMin: -10, uMax: 10 };
      const checks = [];

      // Test 1: P only, Kp = 9. τ_cl = time to reach 63.2 % of the simulated final value.
      const t1 = PidEngine.simulate(Object.assign({ Kp: 9 }, base), { horizon: 3 });
      const m1 = PidEngine.metrics(t1);
      const level = (1 - Math.exp(-1)) * m1.yss;
      let tauCl = NaN;
      for (let i = 1; i < t1.rec.y.length; i++) {
        if (t1.rec.y[i] >= level) {
          const a = t1.rec.y[i - 1], b = t1.rec.y[i];
          tauCl = t1.rec.t[i - 1] + ((level - a) / (b - a)) * (t1.rec.t[i] - t1.rec.t[i - 1]);
          break;
        }
      }
      checks.push({
        name: '1. P only',
        detail: 'Kp = 9, Ki = 0, Kd = 0',
        expected: { main: 'τ_cl = 0.1 s; e_ss = 10%', sub: 'τ/(1 + KKp) and 1/(1 + KKp)' },
        calculated: { main: `τ_cl = ${fmt(tauCl, 4)} s; e_ss = ${fmt(m1.essPct, 2)}%`, sub: `y_final = ${fmt(m1.yss, 4)}, not saturated` },
        pass: m1.status === 'ok' && m1.satTime === 0 && Math.abs(tauCl - 0.1) <= 0.001 && Math.abs(m1.ess - 0.1) <= 0.001
      });

      // Test 2: PI, Kp = 1, Ki = 1. ω_n and ζ from the simulator's own state equations
      // (finite-difference Jacobian A of the closed loop: ω_n = √det A, ζ = −trace A / 2ω_n).
      const J = PidEngine.linearise(Object.assign({ Kp: 1, Ki: 1 }, base));
      const trace = J[0][0] + J[1][1];
      const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
      const wn = Math.sqrt(det);
      const zeta = -trace / (2 * wn);
      checks.push({
        name: '2. PI controller',
        detail: 'Kp = 1, Ki = 1, Kd = 0; closed loop τs² + (1 + KKp)s + KKi = 0',
        expected: { main: 'ω_n = 1 rad/s; ζ = 1', sub: '√(KKi/τ) and (1 + KKp)/(2√(τKKi))' },
        calculated: { main: `ω_n = ${fmt(wn, 4)} rad/s; ζ = ${fmt(zeta, 4)}`, sub: 'from the simulated loop’s state matrix' },
        pass: Math.abs(wn - 1) <= 0.001 && Math.abs(zeta - 1) <= 0.001
      });

      // Test 3: the same stable PI loop, unsaturated: error after 30 s of simulation.
      const t3 = PidEngine.simulate(Object.assign({ Kp: 1, Ki: 1 }, base), { horizon: 30 });
      const m3 = PidEngine.metrics(t3);
      const ess = 1 - t3.rec.y[t3.rec.y.length - 1];
      checks.push({
        name: '3. PI steady-state error',
        detail: 'Kp = 1, Ki = 1, unit step, 30 s simulated',
        expected: { main: 'e_ss ≈ 0', sub: 'tolerance |e_ss| ≤ 1e−4' },
        calculated: { main: Math.abs(ess) < 1e-12 ? 'e_ss < 1e−12' : `e_ss = ${ess.toExponential(1).replace('-', '−')}`, sub: `peak |u| = ${fmt(m3.peakU, 2)}, not saturated` },
        pass: t3.analysis.stable && m3.satTime === 0 && Math.abs(ess) <= 1e-4
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
      ui.plantFirst.forEach((el) => { el.hidden = state.plant !== 'first'; });
      ui.plantSecond.forEach((el) => { el.hidden = state.plant !== 'second'; });
      ui.presetHelp.textContent = PRESET_HELP[state.plant];
      const presets = PRESETS[state.plant];
      ui.presets.forEach((btn) => {
        const p = presets[btn.dataset.preset];
        btn.setAttribute('aria-pressed', String(p.Kp === state.Kp && p.Ki === state.Ki && p.Kd === state.Kd));
      });
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
      if (radio.checked) { state.plant = radio.value; Object.assign(state, PRESETS[state.plant].P); onControlChange(); }
    }));
    ui.presets.forEach((btn) => btn.addEventListener('click', () => {
      Object.assign(state, PRESETS[state.plant][btn.dataset.preset]);
      onControlChange();
    }));
    ui.reset.addEventListener('click', () => {
      Object.assign(state, DEFAULTS, { reference: null });
      syncControls();
      render();
    });

    function snapshot() {
      const keys = ['plant', 'K', 'tau', 'zeta', 'wn', 'Kp', 'Ki', 'Kd', 'dMode', 'r', 'uMax', 'uMin'];
      return Object.fromEntries(keys.map((k) => [k, state[k]]));
    }
    function pinCurrent() { state.reference = snapshot(); render(); }
    ui.pin.addEventListener('click', pinCurrent);
    ui.unpin.addEventListener('click', () => { state.reference = null; render(); });


    // "Predict, then check": checking loads the question's setup and pins it as the reference.
    const predict = createPredictCheck($('p1-predict'), QUESTIONS, {
      onCheck: (q) => {
        Object.assign(state, q.setup, { dMode: 'error', window: 'auto' });
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
  initP1();
}
if (page === "p2") {



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
}
if (page === "p3") {




// P3: Sample the controller and integrate the plant between ticks.
const DigitalPid = (function () {
    'use strict';
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function plant(s) {
        return s.plant === 'second'
            ? { type: 'second', K: s.K, zeta: s.zeta, wn: s.wn }
            : { type: 'first', K: s.K, tau: s.tau };
    }
    function sampleControl(s, y, integral, previousError) {
        const error = s.r - y;
        const derivative = (error - previousError) / s.Ts;
        let nextIntegral = integral + error * s.Ts;
        let raw = s.Kp * error + s.Ki * nextIntegral + s.Kd * derivative;
        const blocked = s.aw && ((raw > s.limit && error > 0) || (raw < -s.limit && error < 0));
        if (blocked) {
            nextIntegral = integral;
            raw = s.Kp * error + s.Ki * integral + s.Kd * derivative;
        }
        return { error, derivative, integral: nextIntegral, raw, u: clamp(raw, -s.limit, s.limit), blocked };
    }
    function integratePlant(s, x, u, h) {
        const f = s.plant === 'second'
            ? (a) => [a[1], s.wn * s.wn * (s.K * u - a[0]) - 2 * s.zeta * s.wn * a[1]]
            : (a) => [(s.K * u - a[0]) / s.tau, 0];
        const k1 = f(x);
        const k2 = f([x[0] + h * k1[0] / 2, x[1] + h * k1[1] / 2]);
        const k3 = f([x[0] + h * k2[0] / 2, x[1] + h * k2[1] / 2]);
        const k4 = f([x[0] + h * k3[0], x[1] + h * k3[1]]);
        return [x[0] + h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6,
            x[1] + h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6];
    }
    function simulate(s) {
        let state = [0, 0], t = 0, integral = 0, previousError = 0, diverged = false;
        const rec = { t: [], y: [], m: [], e: [], u: [], uRaw: [], sat: [], integral: [] };
        const steps = [];
        const horizon = s.horizon;
        const add = (time, c) => {
            rec.t.push(time);
            rec.y.push(state[0]);
            rec.m.push(state[0]);
            rec.e.push(c.error);
            rec.u.push(c.u);
            rec.uRaw.push(c.raw);
            rec.sat.push(c.u !== c.raw);
            rec.integral.push(integral);
        };
        const sampleCount = Math.ceil(horizon / s.Ts);
        for (let k = 0; k < sampleCount && t < horizon - 1e-10; k++) {
            const c = sampleControl(s, state[0], integral, previousError);
            integral = c.integral;
            previousError = c.error;
            steps.push({ x: t, y: c.u });
            add(t, c);
            const end = Math.min(horizon, (k + 1) * s.Ts);
            const duration = end - t;
            const internalMax = s.plant === 'second' ? Math.min(0.01, 0.12 / s.wn) : Math.min(0.01, s.tau / 16);
            const n = Math.max(1, Math.ceil(duration / internalMax));
            const h = duration / n;
            for (let j = 0; j < n; j++) {
                state = integratePlant(s, state, c.u, h);
                t += h;
                add(t, c);
                if (!Number.isFinite(state[0]) || Math.abs(state[0]) > 1e4 * Math.max(1, Math.abs(s.r))) {
                    diverged = true;
                    break;
                }
            }
            t = Math.min(end, t);
            if (diverged)
                break;
        }
        if (steps.length)
            steps.push({ x: t, y: steps[steps.length - 1].y });
        let met;
        try {
            met = PidEngine.metrics({ rec, config: { r: s.r }, analysis: { stable: true }, diverged });
        }
        catch (err) {
            met = { status: 'not-settled', reason: err.message, tr: NaN, mp: NaN, ts: NaN, ess: NaN, essPct: NaN, satTime: NaN };
        }
        return { rec, steps, met, diverged, t, integral, s };
    }
    function arduino(s) {
        const f = n => Number(n).toFixed(5) + 'f';
        const period = Math.round(1e6 * s.Ts);
        return `// ENCS4380 - Control P3: sampled PID controller
// Adapt readSensor() and writeActuator() for your real plant.
#include <Arduino.h>

const float KP = ${f(s.Kp)};
const float KI = ${f(s.Ki)};
const float KD = ${f(s.Kd)};
const float TS = ${f(s.Ts)};    // seconds
const float SETPOINT = ${f(s.r)};
const float U_MIN = ${f(-s.limit)};
const float U_MAX = ${f(s.limit)};
const bool ANTI_WINDUP = ${s.aw ? 'true' : 'false'};
const unsigned long SAMPLE_US = ${period}UL;

float integralError = 0.0f;
float previousError = 0.0f;
unsigned long previousSample = 0;

float readSensor() {
  // Example: normalized analog input [0, 1]. Calibrate for your project.
  return analogRead(A0) / 1023.0f;
}

void writeActuator(float u) {
  // Example signed command mapped to PWM [0, 255].
  // Replace if your actuator only supports one direction.
  float duty = (u - U_MIN) / (U_MAX - U_MIN);
  analogWrite(9, (int)(255.0f * constrain(duty, 0.0f, 1.0f) + 0.5f));
}

void setup() {
  pinMode(9, OUTPUT);
  previousSample = micros() - SAMPLE_US;
}

void loop() {
  unsigned long now = micros();
  if ((unsigned long)(now - previousSample) < SAMPLE_US) return;
  previousSample += SAMPLE_US;

  float y = readSensor();
  float error = SETPOINT - y;
  float derivative = (error - previousError) / TS;
  float nextIntegral = integralError + error * TS;
  float raw = KP * error + KI * nextIntegral + KD * derivative;

  if (ANTI_WINDUP &&
      ((raw > U_MAX && error > 0.0f) ||
       (raw < U_MIN && error < 0.0f))) {
    nextIntegral = integralError;
    raw = KP * error + KI * nextIntegral + KD * derivative;
  }

  integralError = nextIntegral;
  float u = constrain(raw, U_MIN, U_MAX);
  writeActuator(u);
  previousError = error;
}
`;
    }
    return { simulate, arduino, sampleControl, plant };
})();
function initP3() {
    const $ = id => document.getElementById(id);
    const DEFAULTS = { plant: 'first', K: 1, tau: 1, zeta: .5, wn: 2, Ts: .05, Kp: 3, Ki: 3, Kd: 0, aw: true, r: 1, limit: 2, horizon: 24 };
    let state = { ...DEFAULTS };
    let yChart = null, uChart = null, iChart = null, sweepChart = null;
    let reference = null;
    let current = null;
    const SLIDERS = { K: 2, tau: 2, zeta: 2, wn: 2, Ts: 3, Kp: 2, Ki: 2, Kd: 2, r: 2, limit: 2 };
    const PRESETS = {
        fast: { plant: 'first', K: 1, tau: 1, Kp: 5, Ki: 0, Kd: 0, Ts: .02, r: 1, limit: 10, aw: true, horizon: 12 },
        slow: { plant: 'first', K: 1, tau: 1, Kp: 5, Ki: 0, Kd: 0, Ts: .4, r: 1, limit: 10, aw: true, horizon: 12 },
        windup: { plant: 'first', K: 1, tau: 1, Kp: 5, Ki: 9, Kd: 0, Ts: .05, r: 1, limit: 1.2, aw: false, horizon: 24 }
    };
    const QUESTIONS = [
        { prompt: 'If you keep the PID gains fixed but increase the sampling time Ts, what usually happens to stability?',
            choices: [{ text: 'The loop can oscillate because corrections come later.', correct: true }, { text: 'The loop becomes identical to continuous feedback.', correct: false }, { text: 'The output always becomes more accurate.', correct: false }],
            explanation: 'The input is held between samples. When each correction arrives too late, the plant can have already crossed the target.',
            tryIt: 'Try Fast sampling and then Slow sampling. The dashed reference updates rapidly but the slow-sampled response can ring.' },
        { prompt: 'What should a digital PID do to the integral update when the requested command is already beyond the upper limit and the error is positive?',
            choices: [{ text: 'Continue accumulating positive error.', correct: false }, { text: 'Skip the integral update until it can help again.', correct: true }, { text: 'Disable the proportional term.', correct: false }],
            explanation: 'Conditional anti-windup prevents additional integral buildup in the same direction as saturation, but still lets integration unwind later.',
            tryIt: 'Select Windup test and compare the integral plot with anti-windup off and on.' },
        { prompt: 'In the discrete PID equation, what happens to the derivative term when Ts doubles for the same error difference?',
            choices: [{ text: 'It doubles.', correct: false }, { text: 'It is unchanged.', correct: false }, { text: 'It becomes half as large.', correct: true }],
            explanation: 'The backward difference is (e[k]−e[k−1])/Ts. Its value depends on the sample period.',
            tryIt: 'Raise Kd slightly and change Ts. The first digital control sample is especially sensitive to this difference.' }
    ];
    const predict = createPredictCheck($('p3-predict'), QUESTIONS, {
        onCheck(question) {
            if (question === QUESTIONS[0]) {
                state = { ...DEFAULTS, ...PRESETS.slow };
                const fast = DigitalPid.simulate({ ...state, Ts: 0.02 });
                reference = { curve: points(fast.rec, 'y'), Ts: 0.02,
                    Kp: state.Kp, Ki: state.Ki, Kd: state.Kd };
            }
            else if (question === QUESTIONS[1]) {
                state = { ...DEFAULTS, ...PRESETS.windup, aw: false };
                reference = null;
            }
            else {
                state = { ...DEFAULTS, Kp: 2, Ki: 0.5, Kd: 0.2,
                    Ts: 0.05, limit: 10, horizon: 12 };
                reference = null;
            }
            sync();
            schedule();
        }
    });
    const cLine = (label, color, extra = {}) => Object.assign({ label, data: [], borderColor: color, backgroundColor: color, borderWidth: 2.5, pointRadius: 0, tension: 0 }, extra);
    const options = ylabel => ({ responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: { x: { type: 'linear', min: 0, title: { display: true, text: 'Time t (s)' }, grid: { color: THEME.grid } },
            y: { title: { display: true, text: ylabel }, grid: { color: THEME.grid } } },
        plugins: { legend: { display: false }, tooltip: tooltipStyle() } });
    function chart(canvas, ylabel, sets) { return CHARTS_AVAILABLE ? new Chart(canvas, { type: 'line', data: { datasets: sets }, options: options(ylabel) }) : null; }
    const responseMarkers = {
        id: 'p3-response-markers',
        afterDatasetsDraw(chart) {
            if (!current || current.met.status !== 'ok')
                return;
            const { tr, ts, tPeak, yPeak, ess } = current.met;
            const x = chart.scales.x;
            const y = chart.scales.y;
            const { ctx, chartArea } = chart;
            const mark = (time, label, color, offset) => {
                if (!Number.isFinite(time) || time < x.min || time > x.max)
                    return;
                const px = x.getPixelForValue(time);
                ctx.save();
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.font = '600 11px system-ui';
                ctx.setLineDash([3, 4]);
                ctx.beginPath();
                ctx.moveTo(px, chartArea.top);
                ctx.lineTo(px, chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillText(label, Math.min(px + 4, chartArea.right - 65), chartArea.top + 15 + offset);
                ctx.restore();
            };
            mark(tr, 'tᵣ', '#0f766e', 0);
            mark(ts, 'tₛ', '#2563eb', 15);
            if (Number.isFinite(tPeak) && Number.isFinite(yPeak)) {
                const px = x.getPixelForValue(tPeak), py = y.getPixelForValue(yPeak);
                if (px >= chartArea.left && px <= chartArea.right && py >= chartArea.top) {
                    ctx.save();
                    ctx.fillStyle = '#b45309';
                    ctx.beginPath();
                    ctx.arc(px, py, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.font = '600 11px system-ui';
                    ctx.fillText('Mₚ', Math.min(px + 7, chartArea.right - 28), Math.max(chartArea.top + 12, py - 9));
                    ctx.restore();
                }
            }
            if (Number.isFinite(ess)) {
                ctx.save();
                ctx.font = '600 11px system-ui';
                ctx.fillStyle = '#64748b';
                ctx.fillText(`eₛₛ = ${fmt(ess, 3)}`, chartArea.left + 7, chartArea.bottom - 10);
                ctx.restore();
            }
        }
    };
    if (CHARTS_AVAILABLE) {
        applyChartDefaults();
        yChart = chart($('p3-y-chart'), 'Output y(t)', [
            cLine('Setpoint r(t)', THEME.setpoint, { borderDash: [6, 4], borderWidth: 1.5 }),
            cLine('Digital output y(t)', THEME.output),
            cLine('Fast reference (Ts ≤ 0.01 s)', THEME.tau, { borderDash: [6, 4], borderWidth: 1.8 }),
            cLine('Pinned response', THEME.reference, { borderDash: [2, 3], borderWidth: 2, hidden: true })
        ]);
        Chart.register(responseMarkers);
        uChart = chart($('p3-u-chart'), 'Control u[k]', [
            cLine('Held control u[k]', THEME.control, { stepped: 'after' }),
            cLine('Upper limit', THEME.limit, { borderDash: [6, 5], borderWidth: 1.2, pointRadius: 0 }),
            cLine('Lower limit', THEME.limit, { borderDash: [6, 5], borderWidth: 1.2, pointRadius: 0 })
        ]);
        iChart = chart($('p3-i-chart'), 'Integral state I[k]', [
            cLine('Current integral I[k]', THEME.error, { stepped: 'after' }),
            cLine('Opposite anti-windup mode', THEME.reference, { stepped: 'after', borderDash: [4, 4] })
        ]);
        sweepChart = new Chart($('p3-sweep-chart'), {
            type: 'line',
            data: { datasets: [
                    cLine('Overshoot Mₚ (%)', THEME.error, { yAxisID: 'y', spanGaps: false }),
                    cLine('Settling time tₛ (s)', THEME.blue || '#2563eb', { yAxisID: 'y1', spanGaps: false })
                ] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                parsing: false, normalized: true,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                scales: {
                    x: { type: 'linear', min: 0, max: 0.8, title: { display: true, text: 'Sampling time Tₛ (s)' }, grid: { color: THEME.grid } },
                    y: { position: 'left', beginAtZero: true, title: { display: true, text: 'Overshoot (%)' }, grid: { color: THEME.grid } },
                    y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'Settling time (s)' }, grid: { drawOnChartArea: false } }
                },
                plugins: { legend: { display: false }, tooltip: tooltipStyle() }
            }
        });
    }
    else
        document.querySelectorAll('[data-chart-fallback]').forEach(el => el.hidden = false);
    renderLegend($('p3-y-legend'), [
        { kind: 'dashed', color: THEME.setpoint, label: 'Setpoint' }, { kind: 'line', color: THEME.output, label: 'Current digital PID' },
        { kind: 'dashed', color: THEME.tau, label: 'Ts = 0.01 s' }, { kind: 'dotted', color: THEME.reference, label: 'Pinned' }
    ]);
    renderLegend($('p3-u-legend'), [{ kind: 'line', color: THEME.control, label: 'Held u[k]' }, { kind: 'dashed', color: THEME.limit, label: 'Limits' }]);
    renderLegend($('p3-sweep-legend'), [
        { kind: 'line', color: THEME.error, label: 'Overshoot Mₚ (%)' },
        { kind: 'line', color: '#2563eb', label: 'Settling time tₛ (s)' }
    ]);
    renderLegend($('p3-i-legend'), [{ kind: 'line', color: THEME.error, label: 'Current AW setting' }, { kind: 'dashed', color: THEME.reference, label: 'Opposite AW setting' }]);
    function points(rec, key, max = 1600) {
        const skip = Math.max(1, Math.ceil(rec.t.length / max));
        const out = [];
        for (let i = 0; i < rec.t.length; i += skip)
            if (Number.isFinite(rec[key][i]))
                out.push({ x: rec.t[i], y: rec[key][i] });
        const i = rec.t.length - 1;
        if (i >= 0 && (out.length === 0 || out[out.length - 1].x < rec.t[i]) && Number.isFinite(rec[key][i]))
            out.push({ x: rec.t[i], y: rec[key][i] });
        return out;
    }
    function line(v, end) { return [{ x: 0, y: v }, { x: end, y: v }]; }
    function metrics(met) {
        $('p3-m-tr').textContent = fmt(met.tr, 3);
        $('p3-m-mp').textContent = fmt(met.mp, 2);
        $('p3-m-ts').textContent = fmt(met.ts, 3);
        $('p3-m-ess').textContent = fmt(met.ess, 4);
        $('p3-ess-note').textContent = Number.isFinite(met.essPct) ? `${fmt(met.essPct, 2)}% of the setpoint` : 'Error is not reported for an unsettled response.';
    }
    function render() {
        try {
            $('p3-error').hidden = true;
            const data = DigitalPid.simulate(state);
            current = data;
            const fastTs = Math.min(0.01, state.Ts / 2);
            const fast = DigitalPid.simulate({ ...state, Ts: fastTs });
            if (yChart)
                yChart.data.datasets[2].label = `Fast reference (Ts = ${fmt(fastTs, 3)} s)`;
            const opposite = DigitalPid.simulate({ ...state, aw: !state.aw });
            const met = data.met;
            $('p3-response-chip').textContent = `Ts = ${state.Ts.toFixed(3)} s`;
            $('p3-sample-chip').textContent = `${fmt(1 / state.Ts, 1)} updates/s`;
            $('p3-bd-Ts').textContent = `Ts = ${state.Ts.toFixed(3)} s`;
            $('p3-bd-limit').textContent = `±${state.limit.toFixed(1)}`;
            $('p3-bd-plant').textContent = state.plant === 'first' ? `K=${fmt(state.K, 1)}, τ=${fmt(state.tau, 1)}s` : `ζ=${fmt(state.zeta, 2)}, ω=${fmt(state.wn, 1)}`;
            $('p3-aw-chip').textContent = state.aw ? 'Anti-windup ON' : 'Anti-windup OFF';
            const sat = data.rec.sat.some(Boolean);
            $('p3-sat-chip').textContent = sat ? 'Limit reached' : 'Not saturated';
            $('p3-sat-callout').hidden = !sat;
            if (sat)
                $('p3-sat-text').textContent = `The actuator is held inside ±${fmt(state.limit, 2)}. With anti-windup ${state.aw ? 'ON' : 'OFF'}, the integral can ${state.aw ? 'stop building farther into saturation' : 'continue growing beyond what the actuator can deliver'}.`;
            $('p3-u-note').textContent = `Control updates every ${fmt(state.Ts, 3)} s. ${sat ? 'The actuator reached its limit during this run.' : 'No saturation in the current run.'}`;
            updateSweep();
            $('p3-aw-note').textContent = `Peak |integral|: current ${fmt(Math.max(...data.rec.integral.map(Math.abs)), 3)}, opposite mode ${fmt(Math.max(...opposite.rec.integral.map(Math.abs)), 3)}. Larger peaks indicate windup during saturation.`;
            const valid = met.status === 'ok';
            $('p3-status').className = 'status-line ' + (valid ? 'status-line--ok' : met.status === 'unstable' ? 'status-line--bad' : 'status-line--warn');
            $('p3-status').textContent = valid ? 'Stable response in the simulated window. Compare its speed and error with the fast-sampling line.' :
                met.status === 'unstable' ? 'Unstable: the digital output diverged at the selected sample period.' : 'Not settled in the simulated window: sustained oscillation, a limit cycle, or slow convergence is possible. Metrics that need a final value are hidden.';
            metrics(met);
            $('p3-ref-status').textContent = reference ? `Pinned: Ts = ${fmt(reference.Ts, 3)} s, Kp ${fmt(reference.Kp, 1)}, Ki ${fmt(reference.Ki, 1)}, Kd ${fmt(reference.Kd, 2)}` : 'No pinned curve.';
            $('p3-unpin').disabled = !reference;
            $('p3-code').textContent = DigitalPid.arduino(state);
            if (yChart) {
                const ds = yChart.data.datasets;
                ds[0].data = line(state.r, state.horizon);
                ds[1].data = points(data.rec, 'y');
                ds[2].data = points(fast.rec, 'y');
                ds[3].data = reference ? reference.curve : [];
                ds[3].hidden = !reference;
                yChart.options.scales.x.max = state.horizon;
                yChart.update('none');
                uChart.data.datasets[0].data = data.steps;
                uChart.data.datasets[1].data = line(state.limit, state.horizon);
                uChart.data.datasets[2].data = line(-state.limit, state.horizon);
                uChart.options.scales.x.max = state.horizon;
                uChart.update('none');
                iChart.data.datasets[0].data = points(data.rec, 'integral');
                iChart.data.datasets[1].data = points(opposite.rec, 'integral');
                iChart.options.scales.x.max = state.horizon;
                iChart.update('none');
            }
            predict.notifyInteraction();
        }
        catch (err) {
            $('p3-error').hidden = false;
            $('p3-error').textContent = err.message;
            console.error(err);
        }
    }
    function updateSweep() {
        const sampleTimes = [0.005, 0.01, 0.02, 0.035, 0.05, 0.08, 0.12, 0.18,
            0.25, 0.32, 0.4, 0.5, 0.6, 0.7, 0.8];
        if (!sampleTimes.some(ts => Math.abs(ts - state.Ts) < 1e-9)) {
            sampleTimes.push(state.Ts);
            sampleTimes.sort((a, b) => a - b);
        }
        const overshoot = [], settling = [];
        let firstUnsettled = null;
        for (const Ts of sampleTimes) {
            const data = DigitalPid.simulate({ ...state, Ts });
            const met = data.met;
            const settled = met.status === 'ok';
            overshoot.push({ x: Ts, y: settled ? met.mp : null });
            settling.push({ x: Ts, y: settled ? met.ts : null });
            if (!settled && firstUnsettled === null)
                firstUnsettled = Ts;
        }
        if (sweepChart) {
            sweepChart.data.datasets[0].data = overshoot;
            sweepChart.data.datasets[1].data = settling;
            sweepChart.update('none');
        }
        $('p3-sweep-current').textContent = `${fmt(state.Ts, 3)} s`;
        $('p3-sweep-warning').textContent = firstUnsettled === null
            ? 'All tested samples settled' : `${fmt(firstUnsettled, 3)} s`;
        $('p3-sweep-count').textContent = String(sampleTimes.length);
        $('p3-sweep-chip').textContent = `${sampleTimes.length} sample periods`;
        $('p3-sweep-note').textContent = 'At the same PID gains, large sampling intervals can degrade tracking. ' +
            'Gaps represent runs that did not settle within the chosen window, not zero overshoot.';
    }
    function sync() {
        Object.keys(SLIDERS).forEach(key => {
            const el = $('p3-' + key);
            el.value = state[key];
            ControlKit.setSliderFill(el);
            $('p3-' + key + '-value').textContent = key === 'Ts' ? fmt(state[key], 3) + ' s' : key === 'limit' ? '±' + fmt(state[key], 2) :
                key === 'tau' ? fmt(state[key], 2) + ' s' : key === 'wn' ? fmt(state[key], 2) + ' rad/s' :
                    key === 'Ki' ? fmt(state[key], 2) + ' s⁻¹' : key === 'Kd' ? fmt(state[key], 2) + ' s' : fmt(state[key], SLIDERS[key]);
        });
        $('p3-aw').checked = state.aw;
        $('p3-window').value = String(state.horizon);
        $('p3-plant-' + state.plant).checked = true;
        document.querySelectorAll('#p3-root [data-plant]').forEach(el => el.hidden = el.dataset.plant !== state.plant);
    }
    const schedule = ControlKit.frameThrottle(render);
    Object.keys(SLIDERS).forEach(key => $('p3-' + key).addEventListener('input', e => {
        state[key] = Number(e.target.value);
        ControlKit.setSliderFill(e.target);
        sync();
        schedule();
    }));
    document.querySelectorAll('[name="p3-plant"]').forEach(el => el.addEventListener('change', () => { state.plant = el.value; sync(); schedule(); }));
    $('p3-aw').addEventListener('change', e => { state.aw = e.target.checked; schedule(); });
    $('p3-window').addEventListener('change', e => { state.horizon = Number(e.target.value); schedule(); });
    document.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
        Object.assign(state, PRESETS[btn.dataset.preset]);
        reference = null;
        sync();
        $('p3-preset-help').textContent = btn.dataset.preset === 'windup' ? 'Compare anti-windup ON and OFF; the actuator saturates.' :
            btn.dataset.preset === 'slow' ? 'Keep Kp = 5 and compare this slower sample with the fast reference.' : 'Fast sampling of a P-only controller.';
        schedule();
    }));
    $('p3-reset').addEventListener('click', () => { state = { ...DEFAULTS }; reference = null; sync(); schedule(); });
    $('p3-pin').addEventListener('click', () => { if (!current)
        return; reference = { curve: points(current.rec, 'y'), Ts: state.Ts, Kp: state.Kp, Ki: state.Ki, Kd: state.Kd }; render(); });
    $('p3-unpin').addEventListener('click', () => { reference = null; render(); });
    $('p3-copy').addEventListener('click', async () => {
        const code = $('p3-code').textContent;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText)
                await navigator.clipboard.writeText(code);
            else {
                const ta = document.createElement('textarea');
                ta.value = code;
                document.body.appendChild(ta);
                ta.select();
                if (!document.execCommand('copy'))
                    throw Error('Copy command failed');
                ta.remove();
            }
            $('p3-copy-status').textContent = 'Code copied. Update the sensor and actuator functions for your hardware.';
        }
        catch (err) {
            $('p3-copy-status').textContent = 'Copy was blocked by the browser. Select the code and copy it manually.';
        }
    });
    function runValidation() {
        const base = { ...DEFAULTS, plant: 'first', K: 1, tau: 1, r: 1, limit: 100, horizon: 22, Ts: .1, Kp: 1, Ki: 0, Kd: 0 };
        const one = DigitalPid.simulate(base);
        const t1 = one.rec.t.findIndex(t => t >= .1 - 1e-8);
        const y1 = one.rec.y[t1];
        const p = DigitalPid.simulate({ ...base, Ts: .05, horizon: 24 });
        const pi = DigitalPid.simulate({ ...base, Ts: .01, Kp: 1, Ki: 1, horizon: 30 });
        const bad = { ...base, Ts: .05, Kp: 5, Ki: 9, limit: 1.2, horizon: 24 };
        const withAW = DigitalPid.simulate({ ...bad, aw: true });
        const withoutAW = DigitalPid.simulate({ ...bad, aw: false });
        const pi2 = DigitalPid.simulate({ ...base, Ts: 0.02, Kp: 2, Ki: 0.8, horizon: 30 });
        const zoh = DigitalPid.simulate({ ...base, Ts: 0.1, Kp: 1, Ki: 0, Kd: 0 });
        const atTime = time => zoh.rec.y.reduce((best, value, i) => Math.abs(zoh.rec.t[i] - time) < Math.abs(zoh.rec.t[best] - time) ? i : best, 0);
        const zMeasured = (zoh.rec.y[atTime(0.2)] - 0.5) / (zoh.rec.y[atTime(0.1)] - 0.5);
        const zTheory = 2 * Math.exp(-0.1) - 1;
        const checks = [
            { name: 'RK4 under zero-order hold', detail: 'Constant input u = 1 during the first 0.1 s', expected: { main: fmt(1 - Math.exp(-.1), 5), sub: 'Exact first-order step' }, calculated: { main: fmt(y1, 5), sub: 'Digital + RK4' }, pass: Math.abs(y1 - (1 - Math.exp(-.1))) < 2e-5 },
            { name: 'P-only steady-state error', detail: 'K = τ = Kp = 1; Ts = 0.05 s', expected: { main: '50.0%', sub: '1/(1+KKp)' }, calculated: { main: fmt(p.met.essPct, 2) + '%', sub: 'From sampled simulation' }, pass: Math.abs(p.met.essPct - 50) < .1 },
            { name: 'Digital PI removes step error', detail: 'Kp = Ki = 1; Ts = 0.01 s, no saturation', expected: { main: 'e_ss ≈ 0', sub: 'Steady-state integral action' }, calculated: { main: fmt(pi.met.ess, 5), sub: 'Simulated final error' }, pass: pi.met.status === 'ok' && Math.abs(pi.met.ess) < .005 },
            { name: 'Discrete P-only pole', detail: 'K = τ = Kp = 1; Ts = 0.1 s', expected: { main: fmt(zTheory, 5), sub: 'z = (1 + KKp) exp(−Ts/τ) − KKp' }, calculated: { main: fmt(zMeasured, 5), sub: 'From two sampled outputs' }, pass: Math.abs(zMeasured - zTheory) < .001 },
            { name: 'Another PI gain pair removes error', detail: 'Kp = 2, Ki = 0.8; Ts = 0.02 s', expected: { main: 'e_ss ≈ 0', sub: 'Stable PI tracking' }, calculated: { main: fmt(pi2.met.ess, 5), sub: 'Second gain pair' }, pass: pi2.met.status === 'ok' && Math.abs(pi2.met.ess) < .005 },
            { name: 'Anti-windup restricts integral buildup', detail: 'Same saturated plant; AW on versus off', expected: { main: 'lower peak |I|', sub: 'Conditional integration' }, calculated: { main: `${fmt(Math.max(...withAW.rec.integral.map(Math.abs)), 2)} vs ${fmt(Math.max(...withoutAW.rec.integral.map(Math.abs)), 2)}`, sub: 'Peak |I| (on vs off)' }, pass: Math.max(...withAW.rec.integral.map(Math.abs)) < Math.max(...withoutAW.rec.integral.map(Math.abs)) }
        ];
        const n = renderValidation($('p3-validation-body'), checks);
        $('p3-validation-summary').textContent = `${n}/${checks.length} passed`;
        $('p3-validation-summary').className = 'chip ' + (n === checks.length ? 'chip--pass' : 'chip--fail');
    }
    sync();
    runValidation();
    render();
}
initP3();
}
if (page === "p4") {




// P4: Generate a hidden plant and score the tuning requirements.
function initP4() {
    'use strict';
    const $ = id => document.getElementById(id);
    const INITIAL = Object.freeze({ Kp: 2, Ki: 1, Kd: .2 });
    const PRESETS = { P: { Kp: 3, Ki: 0, Kd: 0 }, PI: { Kp: 3, Ki: 2, Kd: 0 }, PID: { Kp: 3, Ki: 2, Kd: .4 } };
    const stats = { seen: 0, checked: 0, perfect: 0, points: 0 };
    let gains = { ...INITIAL }, challenge = null, locked = false, current = null, reference = null;
    let yChart = null, uChart = null;
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    const round = (v, d = 2) => Number(v.toFixed(d));
    const questions = [
        { prompt: 'Your hidden plant rises quickly but overshoots well beyond 10%. Which change is often worth trying?',
            choices: [{ text: 'Increase Ki sharply.', correct: false }, { text: 'Add derivative damping or lower excessive gains.', correct: true }, { text: 'Remove the actuator limit.', correct: false }],
            explanation: 'D action can oppose fast motion and cut overshoot. Stronger P or I can make oscillation worse.',
            tryIt: 'Pin your current curve, increase Kd a little, and compare the new peak.' },
        { prompt: 'The output is smooth, but it settles 15% below the setpoint. Which term helps remove the error?',
            choices: [{ text: 'Integral Ki.', correct: true }, { text: 'Derivative Kd alone.', correct: false }, { text: 'Reducing the simulation time.', correct: false }],
            explanation: 'For a stable closed loop, integral action keeps correcting the steady-state error until it vanishes.',
            tryIt: 'Try a P-only preset followed by PI. Watch the final error in the metric cards.' },
        { prompt: 'The rise time becomes shorter but the loop oscillates for a long time. Which metric will usually fail?',
            choices: [{ text: 'Settling time.', correct: true }, { text: 'Setpoint amplitude.', correct: false }, { text: 'Plant gain.', correct: false }],
            explanation: 'Rise time measures an early crossing; settling time measures the LAST exit from a narrow band.',
            tryIt: 'Compare the oscillating response with a gentler gain using the pin feature.' }
    ];
    const predict = createPredictCheck($('p4-predict'), questions, {
        onCheck(question) {
            if (locked || !current)
                return;
            reference = { curve: pts(current.result.rec, 'y'), ...gains };
            if (question === questions[0]) {
                gains = { ...gains, Kd: Math.min(3, round(gains.Kd + 0.4, 2)) };
            }
            else if (question === questions[1]) {
                gains = { Kp: 3, Ki: 2, Kd: 0 };
            }
            else {
                gains = { ...gains, Kp: Math.max(0, round(gains.Kp - 0.6, 1)) };
            }
            sync();
            schedule();
        }
    });
    const baseOptions = title => ({ responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: { x: { type: 'linear', min: 0, max: 18, title: { display: true, text: 'Time t (s)' }, grid: { color: THEME.grid } },
            y: { title: { display: true, text: title }, grid: { color: THEME.grid } } },
        plugins: { legend: { display: false }, tooltip: tooltipStyle() } });
    const line = (label, color, opts = {}) => Object.assign({ label, data: [], borderColor: color, backgroundColor: color, borderWidth: 2.3, tension: 0, pointRadius: 0 }, opts);
    const responseMarkers = {
        id: 'p4-response-markers',
        afterDatasetsDraw(chart) {
            if (!current || current.met.status !== 'ok')
                return;
            const met = current.met;
            const x = chart.scales.x, y = chart.scales.y;
            const { ctx, chartArea } = chart;
            const marker = (t, label, color, shift) => {
                if (!Number.isFinite(t))
                    return;
                const px = x.getPixelForValue(t);
                ctx.save();
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.font = '600 11px system-ui';
                ctx.setLineDash([3, 4]);
                ctx.beginPath();
                ctx.moveTo(px, chartArea.top);
                ctx.lineTo(px, chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillText(label, Math.min(px + 5, chartArea.right - 40), chartArea.top + 13 + shift);
                ctx.restore();
            };
            marker(met.tr, 'tᵣ', '#0f766e', 0);
            marker(met.ts, 'tₛ', '#2563eb', 15);
            if (Number.isFinite(met.yPeak)) {
                const px = x.getPixelForValue(met.tPeak), py = y.getPixelForValue(met.yPeak);
                if (px >= chartArea.left && px <= chartArea.right) {
                    ctx.save();
                    ctx.fillStyle = '#b45309';
                    ctx.beginPath();
                    ctx.arc(px, py, 4, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.font = '600 11px system-ui';
                    ctx.fillText('Mₚ', Math.min(px + 8, chartArea.right - 25), Math.max(py - 8, chartArea.top + 12));
                    ctx.restore();
                }
            }
            ctx.save();
            ctx.font = '600 11px system-ui';
            ctx.fillStyle = '#64748b';
            ctx.fillText(`eₛₛ = ${fmt(met.essPct, 2)}%`, chartArea.left + 7, chartArea.bottom - 10);
            ctx.restore();
        }
    };
    if (CHARTS_AVAILABLE) {
        applyChartDefaults();
        Chart.register(responseMarkers);
        yChart = new Chart($('p4-y-chart'), { type: 'line', data: { datasets: [
                    line('Setpoint r', THEME.setpoint, { borderDash: [7, 5], borderWidth: 1.5 }),
                    line('Tuned output y(t)', THEME.output, { borderWidth: 2.8 }),
                    line('Pinned response', THEME.reference, { borderDash: [2, 3], hidden: true })
                ] }, options: baseOptions('Output y(t)') });
        uChart = new Chart($('p4-u-chart'), { type: 'line', data: { datasets: [
                    line('Control effort u(t)', THEME.control),
                    line('Upper limit', THEME.limit, { borderDash: [5, 5], borderWidth: 1.3 }),
                    line('Lower limit', THEME.limit, { borderDash: [5, 5], borderWidth: 1.3 })
                ] }, options: baseOptions('Actuator command u(t)') });
    }
    else
        document.querySelectorAll('[data-chart-fallback]').forEach(el => el.hidden = false);
    renderLegend($('p4-y-legend'), [{ kind: 'dashed', color: THEME.setpoint, label: 'Setpoint r(t)' }, { kind: 'line', color: THEME.output, label: 'Output y(t)' }, { kind: 'dotted', color: THEME.reference, label: 'Pinned comparison' }]);
    renderLegend($('p4-u-legend'), [{ kind: 'line', color: THEME.control, label: 'Actuator u(t)' }, { kind: 'dashed', color: THEME.limit, label: 'Limits ±5' }]);
    function newChallenge() {
        const candidates = [
            { Kp: 1.5, Ki: 1, Kd: 0.2 }, { Kp: 2, Ki: 1, Kd: 0.4 },
            { Kp: 3, Ki: 1.5, Kd: 0.5 }, { Kp: 4, Ki: 2, Kd: 0.8 },
            { Kp: 2, Ki: 2, Kd: 0.8 }, { Kp: 3, Ki: 2, Kd: 1.2 }
        ];
        for (let attempt = 0; attempt < 16; attempt++) {
            const isSecond = Math.random() < 0.5;
            const plant = isSecond
                ? { type: 'second', K: round(rand(0.8, 1.5)),
                    zeta: round(rand(0.35, 0.85)), wn: round(rand(1.3, 3.1)) }
                : { type: 'first', K: round(rand(0.75, 1.65)), tau: round(rand(0.65, 2.15)) };
            for (const candidate of candidates) {
                const result = PidEngine.simulate({ plant, ...candidate,
                    dMode: 'measurement', r: 1, uMin: -5, uMax: 5 }, { horizon: 18 });
                const met = PidEngine.metrics(result);
                if (met.status !== 'ok' || met.mp > 9 || met.ts > 8.5 ||
                    Math.abs(met.essPct) > 0.8)
                    continue;
                return {
                    plant,
                    spec: { os: 10, ts: round(Math.ceil((met.ts + 0.8) * 2) / 2, 1), ess: 1 },
                    number: ++stats.seen
                };
            }
        }
        return {
            plant: { type: 'first', K: 1, tau: 1 },
            spec: { os: 10, ts: 6, ess: 1 },
            number: ++stats.seen
        };
    }
    function config() { return { plant: challenge.plant, Kp: gains.Kp, Ki: gains.Ki, Kd: gains.Kd, dMode: 'measurement', r: 1, uMin: -5, uMax: 5 }; }
    function pts(rec, key, n = 1300) {
        const points = [];
        const every = Math.max(1, Math.ceil(rec.t.length / n));
        for (let i = 0; i < rec.t.length; i += every)
            if (Number.isFinite(rec[key][i]))
                points.push({ x: rec.t[i], y: rec[key][i] });
        const i = rec.t.length - 1;
        if (i >= 0 && Number.isFinite(rec[key][i]) && (points.length === 0 || points[points.length - 1].x < rec.t[i]))
            points.push({ x: rec.t[i], y: rec[key][i] });
        return points;
    }
    function flat(value, end = 18) { return [{ x: 0, y: value }, { x: end, y: value }]; }
    function displayStatus(met) {
        const ok = met.status === 'ok';
        $('p4-status').className = 'status-line ' + (ok ? 'status-line--ok' : met.status === 'unstable' || met.status === 'oscillating' ? 'status-line--bad' : 'status-line--warn');
        $('p4-status').textContent = ok ? 'The simulated response has settled. Compare all three live values with the targets above.' :
            met.status === 'unstable' ? 'The loop diverged: try lower gains. A divergent response cannot pass the specification.' :
                'The response has not settled in the simulation window. Reduce oscillation or increase the damping.';
    }
    function refresh() {
        if (!challenge)
            return;
        try {
            $('p4-error').hidden = true;
            const result = PidEngine.simulate(config(), { horizon: 18 });
            const met = PidEngine.metrics(result);
            current = { result, met };
            const stable = met.status === 'ok';
            $('p4-m-tr').textContent = fmt(met.tr, 3);
            $('p4-m-os').textContent = fmt(met.mp, 2);
            $('p4-m-ts').textContent = fmt(met.ts, 3);
            $('p4-m-ess').textContent = stable ? fmt(Math.abs(met.essPct), 2) : '—';
            displayStatus(met);
            const sat = result.rec.sat.some(Boolean);
            $('p4-u-chip').textContent = sat ? 'Actuator saturated' : 'No saturation';
            $('p4-u-note').textContent = sat ? 'The actuator reached a limit; the plotted u(t) is the command the plant actually receives.' : 'The commanded u(t) stays inside the actuator limits.';
            $('p4-gains-chip').textContent = `Kp ${fmt(gains.Kp, 1)} · Ki ${fmt(gains.Ki, 1)} · Kd ${fmt(gains.Kd, 2)}`;
            $('p4-bd-gains').textContent = `P=${fmt(gains.Kp, 1)}, I=${fmt(gains.Ki, 1)}, D=${fmt(gains.Kd, 2)}`;
            $('p4-ref-status').textContent = reference ? `Pinned gains: Kp ${fmt(reference.Kp, 1)}, Ki ${fmt(reference.Ki, 1)}, Kd ${fmt(reference.Kd, 2)}` : 'No pinned curve.';
            $('p4-unpin').disabled = !reference;
            if (yChart) {
                yChart.data.datasets[0].data = flat(1);
                yChart.data.datasets[1].data = pts(result.rec, 'y');
                yChart.data.datasets[2].data = reference ? reference.curve : [];
                yChart.data.datasets[2].hidden = !reference;
                yChart.update('none');
                uChart.data.datasets[0].data = pts(result.rec, 'u');
                uChart.data.datasets[1].data = flat(5);
                uChart.data.datasets[2].data = flat(-5);
                uChart.update('none');
            }
            predict.notifyInteraction();
        }
        catch (err) {
            $('p4-error').hidden = false;
            $('p4-error').textContent = err.message;
            console.error(err);
        }
    }
    function criteria(met) {
        const ok = met.status === 'ok';
        const spec = challenge.spec;
        return [
            { name: 'Overshoot', points: 30, pass: ok && met.mp <= spec.os + 1e-7, expected: `≤ ${fmt(spec.os, 0)}%`, value: ok ? `${fmt(met.mp, 2)}%` : 'Not settled' },
            { name: 'Settling time', points: 35, pass: ok && met.ts <= spec.ts + 1e-7, expected: `≤ ${fmt(spec.ts, 1)} s`, value: ok ? `${fmt(met.ts, 3)} s` : 'Not settled' },
            { name: 'Steady-state error', points: 35, pass: ok && Math.abs(met.essPct) <= spec.ess + 1e-7, expected: `≤ ${fmt(spec.ess, 1)}%`, value: ok ? `${fmt(Math.abs(met.essPct), 3)}%` : 'Not settled' }
        ];
    }
    function revealPlant() {
        const p = challenge.plant;
        const txt = p.type === 'first' ? `K = ${fmt(p.K, 2)}, τ = ${fmt(p.tau, 2)} s` :
            `K = ${fmt(p.K, 2)}, ζ = ${fmt(p.zeta, 2)}, ωn = ${fmt(p.wn, 2)} rad/s`;
        $('p4-hidden-text').textContent = txt;
        $('p4-reveal').textContent = `Revealed plant: ${txt}. ${p.type === 'first' ? `G(s) = ${fmt(p.K, 2)} / (${fmt(p.tau, 2)}s + 1)` : `G(s) = Kωn² / (s² + 2ζωn s + ωn²)`}.`;
        $('p4-plant-chip').textContent = 'Plant parameters revealed';
        $('p4-bd-plant').textContent = txt;
    }
    function checkTuning() {
        if (locked || !current)
            return;
        const items = criteria(current.met);
        const score = items.reduce((sum, x) => sum + (x.pass ? x.points : 0), 0);
        stats.checked++;
        stats.points += score;
        if (score === 100)
            stats.perfect++;
        locked = true;
        ['Kp', 'Ki', 'Kd'].forEach(k => $('p4-' + k).disabled = true);
        document.querySelectorAll('#p4-controls [data-preset]').forEach(el => el.disabled = true);
        $('p4-reset').disabled = true;
        $('p4-check').disabled = true;
        $('p4-attempt-chip').textContent = 'Round scored';
        const checks = $('p4-checks');
        checks.replaceChildren();
        items.forEach(item => {
            const card = document.createElement('article');
            card.className = 'challenge-test ' + (item.pass ? 'pass' : 'fail');
            const h = document.createElement('h3');
            h.textContent = item.name;
            const strong = document.createElement('strong');
            strong.textContent = item.pass ? 'PASS' : 'FAIL';
            const value = document.createElement('p');
            value.textContent = `Result: ${item.value} · Target: ${item.expected}`;
            const points = document.createElement('p');
            points.textContent = `${item.pass ? item.points : 0} / ${item.points} points`;
            card.append(h, strong, value, points);
            checks.append(card);
        });
        $('p4-result').hidden = false;
        $('p4-score-title').textContent = score === 100 ? 'All specifications passed!' : 'Tuning checked';
        $('p4-score-text').textContent = `You earned ${score}/100 points. ${score === 100 ? 'Your controller meets every requirement.' : 'Review the failed specifications and try a different tuning on the next plant.'} This round cannot be scored again.`;
        $('p4-total').textContent = `${stats.points} / ${stats.checked * 100}`;
        $('p4-rounds').textContent = String(stats.checked);
        $('p4-perfect').textContent = String(stats.perfect);
        $('p4-score-callout').className = 'callout ' + (score === 100 ? '' : 'callout--warn');
        revealPlant();
    }
    function sync() {
        ['Kp', 'Ki', 'Kd'].forEach(key => {
            const el = $('p4-' + key);
            el.value = gains[key];
            ControlKit.setSliderFill(el);
            $('p4-' + key + '-value').textContent = fmt(gains[key], key === 'Kd' ? 2 : 1) + (key === 'Ki' ? ' s⁻¹' : key === 'Kd' ? ' s' : '');
        });
    }
    function startRound() {
        challenge = newChallenge();
        locked = false;
        reference = null;
        gains = { ...INITIAL };
        ['Kp', 'Ki', 'Kd'].forEach(k => $('p4-' + k).disabled = false);
        document.querySelectorAll('#p4-controls [data-preset]').forEach(el => el.disabled = false);
        $('p4-reset').disabled = false;
        $('p4-check').disabled = false;
        $('p4-result').hidden = true;
        $('p4-attempt-chip').textContent = 'Ready to check';
        $('p4-plant-chip').textContent = 'Plant parameters hidden';
        $('p4-hidden-text').textContent = 'G(s) = ?';
        $('p4-bd-plant').textContent = 'G(s) = ?';
        $('p4-spec-os').textContent = `≤ ${challenge.spec.os}%`;
        $('p4-spec-ts').textContent = `≤ ${fmt(challenge.spec.ts, 1)} s`;
        $('p4-spec-ess').textContent = `≤ ${fmt(challenge.spec.ess, 0)}%`;
        $('p4-round-chip').textContent = `Round ${challenge.number}`;
        const kind = challenge.plant.type === 'first' ? 'First-order' : 'Second-order';
        $('p4-challenge-kind').textContent = `Hidden ${kind.toLowerCase()} plant`;
        $('p4-type').textContent = `${kind} plant. Its numerical parameters are secret until you check.`;
        $('p4-spec-note').textContent = 'These targets were checked against at least one feasible PID tuning. Find your own gains within actuator limits ±5.';
        $('p4-preset-help').textContent = 'Adjust one gain at a time. Check tuning when you are ready.';
        sync();
        refresh();
    }
    const schedule = ControlKit.frameThrottle(refresh);
    ['Kp', 'Ki', 'Kd'].forEach(key => $('p4-' + key).addEventListener('input', ev => {
        if (locked)
            return;
        gains[key] = Number(ev.target.value);
        ControlKit.setSliderFill(ev.target);
        $('p4-' + key + '-value').textContent = fmt(gains[key], key === 'Kd' ? 2 : 1) + (key === 'Ki' ? ' s⁻¹' : key === 'Kd' ? ' s' : '');
        schedule();
    }));
    document.querySelectorAll('#p4-controls [data-preset]').forEach(btn => btn.addEventListener('click', () => {
        if (locked)
            return;
        gains = { ...PRESETS[btn.dataset.preset] };
        sync();
        schedule();
        $('p4-preset-help').textContent = btn.dataset.preset === 'P' ? 'P alone typically leaves a final error. Add integral action if necessary.' :
            btn.dataset.preset === 'PI' ? 'PI should help remove the final error. Check the overshoot.' : 'PID adds derivative action for damping.';
    }));
    $('p4-reset').addEventListener('click', () => { if (locked)
        return; gains = { ...INITIAL }; sync(); schedule(); });
    $('p4-new-plant').addEventListener('click', startRound);
    $('p4-next').addEventListener('click', startRound);
    $('p4-check').addEventListener('click', checkTuning);
    $('p4-pin').addEventListener('click', () => { if (!current)
        return; reference = { curve: pts(current.result.rec, 'y'), ...gains }; refresh(); });
    $('p4-unpin').addEventListener('click', () => { reference = null; refresh(); });
    function runValidation() {
        const base = { plant: { type: 'first', K: 1, tau: 1 }, Kp: 9, Ki: 0, Kd: 0, r: 1, uMin: -10, uMax: 10 };
        const p = PidEngine.simulate(base, { horizon: 10 });
        const pm = PidEngine.metrics(p);
        const pi = PidEngine.simulate({ ...base, Kp: 1, Ki: 1 }, { horizon: 24 });
        const pim = PidEngine.metrics(pi);
        const coeffs = PidEngine.characteristicPolynomial({ ...base, Kp: 1, Ki: 1 });
        const pi2 = PidEngine.simulate({ ...base, Kp: 2, Ki: 0.8 }, { horizon: 28 });
        const pi2m = PidEngine.metrics(pi2);
        const checks = [
            { name: 'P-only steady-state error', detail: 'K = τ = 1, Kp = 9', expected: { main: '10.0%', sub: 'From 1 / (1 + KKp)' }, calculated: { main: fmt(pm.essPct, 2) + '%', sub: 'RK4 output' }, pass: Math.abs(pm.essPct - 10) < .1 },
            { name: 'PI characteristic polynomial', detail: 'Kp = Ki = K = τ = 1', expected: { main: 's² + 2s + 1', sub: 'ωn = 1, ζ = 1' }, calculated: { main: `${fmt(coeffs[2], 0)}s² + ${fmt(coeffs[1], 0)}s + ${fmt(coeffs[0], 0)}`, sub: 'Closed-loop equation' }, pass: Math.abs(coeffs[0] - 1) < 1e-9 && Math.abs(coeffs[1] - 2) < 1e-9 && Math.abs(coeffs[2] - 1) < 1e-9 },
            { name: 'Second PI gain combination', detail: 'Kp = 2, Ki = 0.8', expected: { main: 'e_ss ≈ 0', sub: 'Another stable PI' }, calculated: { main: fmt(pi2m.ess, 5), sub: '28 s RK4 run' }, pass: pi2m.status === 'ok' && Math.abs(pi2m.ess) < .002 },
            { name: 'PI removes final step error', detail: 'Kp = Ki = 1', expected: { main: 'e_ss ≈ 0' }, calculated: { main: fmt(pim.ess, 5), sub: 'After 24 s' }, pass: pim.status === 'ok' && Math.abs(pim.ess) < .001 }
        ];
        const n = renderValidation($('p4-validation-body'), checks);
        $('p4-validation-summary').textContent = `${n}/${checks.length} passed`;
        $('p4-validation-summary').className = 'chip ' + (n === checks.length ? 'chip--pass' : 'chip--fail');
    }
    runValidation();
    startRound();
}
initP4();
}
if (page === "mysystem") {




// My System: measured first-order plant and digital PID with normalized PWM.
function initMySystem() {
  'use strict';
  const $ = id => document.getElementById(id);
  const fields = ['project', 'source', 'K', 'tau', 'Ts', 'r', 'Kp', 'Ki', 'Kd',
                  'spec-os', 'spec-ts', 'spec-ess', 'reason'];
  const numericFields = ['K', 'tau', 'Ts', 'r', 'Kp', 'Ki', 'Kd', 'spec-os', 'spec-ts', 'spec-ess'];
  let responseChart = null, controlChart = null, latest = null;

  const read = () => {
    const data = Object.fromEntries(fields.map(k => [k, $("ms-" + k).value.trim()]));
    numericFields.forEach(k => { data[k] = Number(data[k]); });
    data.aw = $('ms-aw').checked;
    if (!(data.K > 0 && data.tau > 0 && data.Ts >= 0.005 && data.Ts <= 0.5)) {
      throw Error('K, τ and sampling time must be valid positive values.');
    }
    if (!(data.r > 0 && data.r <= 1)) throw Error('The normalized setpoint must be between 0 and 1.');
    if (['Kp', 'Ki', 'Kd'].some(k => !(data[k] >= 0))) throw Error('PID gains must be nonnegative.');
    if (['spec-os', 'spec-ts', 'spec-ess'].some(k => !(data[k] >= 0))) {
      throw Error('The specification limits must not be negative.');
    }
    return data;
  };

  function pidStep(s, y, integral, previousError) {
    const error = s.r - y;
    const derivative = (error - previousError) / s.Ts;
    let nextIntegral = integral + error * s.Ts;
    let raw = s.Kp * error + s.Ki * nextIntegral + s.Kd * derivative;
    if (s.aw && ((raw > 1 && error > 0) || (raw < 0 && error < 0))) {
      nextIntegral = integral;
      raw = s.Kp * error + s.Ki * nextIntegral + s.Kd * derivative;
    }
    return { error, integral: nextIntegral, u: Math.max(0, Math.min(1, raw)), raw };
  }

  function rk4(y, u, h, K, tau) {
    const slope = value => (K * u - value) / tau;
    const a = slope(y), b = slope(y + h * a / 2);
    const c = slope(y + h * b / 2), d = slope(y + h * c);
    return y + (h / 6) * (a + 2 * b + 2 * c + d);
  }

  function simulate(s) {
    const horizon = Math.min(140, Math.max(30, 14 * s.tau));
    const rec = { t: [], y: [], u: [], sat: [], e: [] };
    const held = [];
    let y = 0, t = 0, integral = 0, previousError = 0;
    let diverged = false;
    for (let k = 0; t < horizon - 1e-9; k++) {
      const c = pidStep(s, y, integral, previousError);
      integral = c.integral;
      previousError = c.error;
      held.push({ x: t, y: c.u });
      const write = () => {
        rec.t.push(t);
        rec.y.push(y);
        rec.u.push(c.u);
        rec.e.push(c.error);
        rec.sat.push(Math.abs(c.u - c.raw) > 1e-9);
      };
      write();
      const until = Math.min(horizon, (k + 1) * s.Ts);
      const substeps = Math.max(1, Math.ceil((until - t) / Math.min(0.015, s.tau / 16)));
      const h = (until - t) / substeps;
      for (let j = 0; j < substeps; j++) {
        y = rk4(y, c.u, h, s.K, s.tau);
        t += h;
        write();
        if (!Number.isFinite(y) || Math.abs(y) > 1e4) { diverged = true; break; }
      }
      t = until;
      if (diverged) break;
    }
    if (held.length) held.push({ x: t, y: held[held.length - 1].y });
    const simulation = { rec, config: { r: s.r }, analysis: { stable: true }, diverged };
    const met = PidEngine.metrics(simulation);
    return { rec, held, met, horizon };
  }

  const dataset = (label, color, extra = {}) => ({
    label, data: [], borderColor: color, backgroundColor: color,
    pointRadius: 0, borderWidth: 2.5, tension: 0, ...extra
  });
  function chartOptions(yLabel) {
    return {
      responsive: true, maintainAspectRatio: false, parsing: false,
      animation: false, normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, title: { display: true, text: 'Time (s)' }, grid: { color: THEME.grid } },
        y: { title: { display: true, text: yLabel }, grid: { color: THEME.grid } }
      },
      plugins: { legend: { display: false }, tooltip: tooltipStyle() }
    };
  }
  if (CHARTS_AVAILABLE) {
    applyChartDefaults();
    responseChart = new Chart($('ms-y-chart'), {
      type: 'line', data: { datasets: [
        dataset('Setpoint', THEME.setpoint, { borderDash: [6, 5], borderWidth: 1.6 }),
        dataset('System output', THEME.output)
      ] }, options: chartOptions('Normalized output')
    });
    controlChart = new Chart($('ms-u-chart'), {
      type: 'line', data: { datasets: [
        dataset('PWM fraction', THEME.control, { stepped: 'after' }),
        dataset('Maximum PWM', THEME.limit, { borderDash: [6, 4], borderWidth: 1.3 }),
        dataset('Minimum PWM', THEME.limit, { borderDash: [6, 4], borderWidth: 1.3 })
      ] }, options: chartOptions('PWM fraction (0 to 1)')
    });
  } else document.querySelectorAll('[data-chart-fallback]').forEach(el => { el.hidden = false; });
  renderLegend($('ms-y-legend'), [
    { kind: 'dashed', color: THEME.setpoint, label: 'Setpoint' },
    { kind: 'line', color: THEME.output, label: 'System output' }
  ]);
  renderLegend($('ms-u-legend'), [
    { kind: 'line', color: THEME.control, label: 'Held PWM' },
    { kind: 'dashed', color: THEME.limit, label: 'PWM limits' }
  ]);

  const questions = [
    { prompt: 'Your first-order plant stops below the setpoint with P-only control. What helps remove the remaining error?',
      choices: [{ text: 'Raise Kd alone.', correct: false },
                { text: 'Enable integral action Ki.', correct: true },
                { text: 'Increase the sampling time.', correct: false }],
      explanation: 'For a stable loop that is not permanently saturated, integral action removes step steady-state error.',
      tryIt: 'This question loads a PI preset. Compare the final tracking value with P-only using the buttons on the left.' },
    { prompt: 'What does a larger sampling time mean for the same digital PID gains?',
      choices: [{ text: 'Later feedback may create oscillation.', correct: true },
                { text: 'The plant automatically becomes faster.', correct: false },
                { text: 'Derivative and integral terms stop using Ts.', correct: false }],
      explanation: 'The controller holds the last PWM command until the next sample. A longer hold can worsen stability.',
      tryIt: 'The sample time has been increased to 0.2 s so you can compare its response with a smaller value.' }
  ];
  const predict = createPredictCheck($('ms-predict'), questions, {
    onCheck(question) {
      if (question === questions[0]) {
        $('ms-Kp').value = '1'; $('ms-Ki').value = '1'; $('ms-Kd').value = '0';
      } else $('ms-Ts').value = '0.2';
      update();
    }
  });

  function arduino(s) {
    const f = n => Number(n).toFixed(6) + 'f';
    const period = Math.round(s.Ts * 1e6);
    return `// ENCS4380 - My System: sampled PID and normalized PWM
// Replace sensor reading and PWM mapping for your actual project hardware.
#include <Arduino.h>

const float KP = ${f(s.Kp)};
const float KI = ${f(s.Ki)};
const float KD = ${f(s.Kd)};
const float TS = ${f(s.Ts)};
const float SETPOINT = ${f(s.r)};
const bool ANTI_WINDUP = ${s.aw ? 'true' : 'false'};
const unsigned long SAMPLE_US = ${period}UL;
const int PWM_PIN = 9;

float integralError = 0.0f;
float previousError = 0.0f;
unsigned long previousSample = 0;

float readSensor() {
  // Example normalized A0 reading, NOT an encoder speed measurement.
  return analogRead(A0) / 1023.0f;
}

void writeActuator(float u) {
  // One-direction output: normalized u = 0..1 maps to PWM = 0..255.
  analogWrite(PWM_PIN, (int)(255.0f * constrain(u, 0.0f, 1.0f) + 0.5f));
}

void setup() {
  pinMode(PWM_PIN, OUTPUT);
  previousSample = micros() - SAMPLE_US;
}

void loop() {
  unsigned long now = micros();
  if ((unsigned long)(now - previousSample) < SAMPLE_US) return;
  previousSample += SAMPLE_US;
  float y = readSensor();
  float error = SETPOINT - y;
  float derivative = (error - previousError) / TS;
  float nextIntegral = integralError + error * TS;
  float raw = KP * error + KI * nextIntegral + KD * derivative;
  if (ANTI_WINDUP &&
      ((raw > 1.0f && error > 0.0f) || (raw < 0.0f && error < 0.0f))) {
    nextIntegral = integralError;
    raw = KP * error + KI * nextIntegral + KD * derivative;
  }
  integralError = nextIntegral;
  writeActuator(constrain(raw, 0.0f, 1.0f));
  previousError = error;
}
`;
  }

  function showSpecs(s, met) {
    const settled = met.status === 'ok';
    const checks = [
      { label: 'Overshoot', pass: settled && met.mp <= s['spec-os'],
        actual: settled ? `${fmt(met.mp, 2)}%` : 'Not settled', goal: `≤ ${s['spec-os']}%` },
      { label: 'Settling time', pass: settled && met.ts <= s['spec-ts'],
        actual: settled ? `${fmt(met.ts, 3)} s` : 'Not settled', goal: `≤ ${s['spec-ts']} s` },
      { label: 'Steady-state error', pass: settled && Math.abs(met.essPct) <= s['spec-ess'],
        actual: settled ? `${fmt(Math.abs(met.essPct), 3)}%` : 'Not settled', goal: `≤ ${s['spec-ess']}%` }
    ];
    $('ms-spec-results').replaceChildren(...checks.map(c => {
      const article = document.createElement('article');
      article.className = 'challenge-test ' + (c.pass ? 'pass' : 'fail');
      const h = document.createElement('h3'); h.textContent = c.label;
      const title = document.createElement('strong'); title.textContent = c.pass ? 'PASS' : 'FAIL';
      const p = document.createElement('p'); p.textContent = `Measured: ${c.actual} · Target: ${c.goal}`;
      article.append(h, title, p);
      return article;
    }));
    return checks;
  }

  function curvePoints(rec, key, max = 1500) {
    const skip = Math.max(1, Math.ceil(rec.t.length / max));
    const arr = [];
    for (let i = 0; i < rec.t.length; i += skip) {
      if (Number.isFinite(rec[key][i])) arr.push({ x: rec.t[i], y: rec[key][i] });
    }
    return arr;
  }

  function update() {
    try {
      const s = read();
      const result = simulate(s);
      const met = result.met;
      latest = { s, result };
      $('ms-error').hidden = true;
      const sourced = Boolean(s.source.trim()) && s.project !== 'Example first-order plant';
      $('ms-warning').hidden = sourced;
      $('ms-source-chip').textContent = sourced ? 'Source recorded' : 'Example only';
      $('ms-source-chip').className = 'chip ' + (sourced ? 'chip--pass' : 'chip--fail');
      $('ms-model-text').textContent = `G(s) = ${fmt(s.K, 4)} / (${fmt(s.tau, 4)}s + 1)`;
      $('ms-source-text').textContent = 'Source: ' + (s.source || 'NOT PROVIDED');
      $('ms-sample-chip').textContent = `Tₛ = ${fmt(s.Ts, 3)} s`;
      $('ms-status-chip').textContent = met.status === 'ok' ? 'Settled' : 'Not settled';
      $('ms-status-chip').className = 'chip ' + (met.status === 'ok' ? 'chip--pass' : 'chip--fail');
      $('ms-tr').textContent = fmt(met.tr, 3) + ' s';
      $('ms-mp').textContent = fmt(met.mp, 2) + '%';
      $('ms-ts').textContent = fmt(met.ts, 3) + ' s';
      $('ms-ess').textContent = fmt(Math.abs(met.essPct), 3) + '%';
      $('ms-response-note').textContent = met.status === 'ok'
        ? 'Response settled in the simulation. Apply your own specifications and confirm the hardware model.'
        : 'Response not settled in the simulated window. Check gains, saturation and the sample time.';
      const checks = showSpecs(s, met);
      if (responseChart) {
        responseChart.data.datasets[0].data = [{ x: 0, y: s.r }, { x: result.horizon, y: s.r }];
        responseChart.data.datasets[1].data = curvePoints(result.rec, 'y');
        responseChart.options.scales.x.max = result.horizon;
        responseChart.update('none');
        controlChart.data.datasets[0].data = result.held;
        controlChart.data.datasets[1].data = [{ x: 0, y: 1 }, { x: result.horizon, y: 1 }];
        controlChart.data.datasets[2].data = [{ x: 0, y: 0 }, { x: result.horizon, y: 0 }];
        controlChart.options.scales.x.max = result.horizon;
        controlChart.update('none');
      }
      $('ms-code').textContent = arduino(s);
      $('ms-summary').textContent = [
        `Project: ${s.project}`,
        `Plant: G(s) = ${s.K}/(${s.tau}s+1)` + (sourced ? '' : ' [DEMONSTRATION — REPLACE]'),
        `Source: ${s.source || 'MISSING — required for submission'}`,
        `Spec: Overshoot ≤ ${s['spec-os']}%, settling ≤ ${s['spec-ts']} s, |e_ss| ≤ ${s['spec-ess']}%`,
        `Why the spec matters: ${s.reason || 'MISSING — explain for your project'}`,
        `Gains: Kp=${s.Kp}, Ki=${s.Ki}, Kd=${s.Kd}, Ts=${s.Ts} s, anti-windup=${s.aw}`,
        `Output: rise ${fmt(met.tr, 3)} s, overshoot ${fmt(met.mp, 2)}%, settling ${fmt(met.ts, 3)} s, |e_ss| ${fmt(Math.abs(met.essPct), 3)}%`,
        `Targets: ${checks.map(x => x.label + ' ' + (x.pass ? 'PASS' : 'FAIL')).join('; ')}`,
        'Simulation: sampled PID + zero-order hold + RK4; Arduino hardware functions require adaptation.'
      ].join('\n');
      predict.notifyInteraction();
      try { localStorage.setItem('encs4380-my-system', JSON.stringify(Object.fromEntries([
        ...fields.map(k => [k, $('ms-' + k).value]), ['aw', s.aw]
      ]))); } catch (_) { /* local storage may be unavailable on file URLs */ }
    } catch (err) {
      $('ms-error').hidden = false;
      $('ms-error').textContent = err.message;
      latest = null;
    }
  }

  const scheduled = ControlKit.frameThrottle(update);
  fields.forEach(k => $('ms-' + k).addEventListener('input', scheduled));
  $('ms-aw').addEventListener('change', scheduled);
  document.querySelectorAll('[data-ms-preset]').forEach(button => button.addEventListener('click', () => {
    const values = { P: [2, 0, 0], PI: [2, 1, 0], PID: [2, 1, 0.2] }[button.dataset.msPreset];
    ['Kp', 'Ki', 'Kd'].forEach((k, i) => { $('ms-' + k).value = String(values[i]); });
    update();
  }));
  async function copyText(text, status) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else {
        const box = document.createElement('textarea');
        box.value = text; document.body.append(box); box.select();
        if (!document.execCommand('copy')) throw Error('Copy failed');
        box.remove();
      }
      status.textContent = 'Copied successfully.';
    } catch (_) { status.textContent = 'Browser blocked copying. Select and copy the text manually.'; }
  }
  $('ms-copy').addEventListener('click', () => copyText($('ms-code').textContent, $('ms-copy-status')));
  $('ms-summary-copy').addEventListener('click', () => copyText($('ms-summary').textContent, $('ms-copy-status')));
  try {
    const saved = JSON.parse(localStorage.getItem('encs4380-my-system') || 'null');
    if (saved) {
      fields.forEach(k => { if (saved[k] !== undefined) $('ms-' + k).value = saved[k]; });
      $('ms-aw').checked = saved.aw !== false;
    }
  } catch (_) { /* use defaults */ }
  update();
}
initMySystem();
}
}
})();
