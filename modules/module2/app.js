
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

    

    retryBtn.addEventListener('click', () => {
      current = 0;
      renderQuestion();
      const first = choicesBox.querySelector('input');
      if (first) first.focus();
    });

    nextBtn.addEventListener('click', () => {
      if (current >= questions.length - 1) return;
      current += 1;
      renderQuestion();
      const first = choicesBox.querySelector('input');
      if (first) first.focus();
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
          "±" + check.tolerance + check.unit, passed ? "PASS" : "FAIL"];
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }
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
  