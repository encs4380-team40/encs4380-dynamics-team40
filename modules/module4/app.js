
    // ENCS4380 - Module 4: Guess the Sensor
    // Pure browser-side implementation with a dependency-free SVG chart.
    const $ = id => document.getElementById(id);
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
        context.strokeStyle='#eef1f4';
        context.stroke();
        context.textAlign='center';
        context.fillStyle='#193044';
        context.fillText(Number(value.toPrecision(2)).toString(),x,margin.top+plotHeight+15);
      }
      for(let i=0;i<=4;i++) {
        const y=margin.top+plotHeight*i/4;
        const value=yMax-(yMax-yMin)*i/4;
        context.beginPath();
        context.moveTo(margin.left,y);
        context.lineTo(margin.left+plotWidth,y);
        context.strokeStyle='#eef1f4';
        context.stroke();
        context.textAlign='right';
        context.fillStyle='#193044';
        context.fillText(Number(value.toPrecision(2)).toString(),margin.left-7,y+4);
      }
      context.textAlign='center';
      context.fillStyle='#193044';
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
        context.fillStyle='#193044';
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
      traces.push({x:c.sampleT,y:c.samples,mode:'markers',name:'Noisy sensor samples',marker:{color:'#007c83',size:5,opacity:.8}});
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
        const mode=Math.floor(Math.random()*3);
        const zeta=mode===0?roundTo(rand(.2,.8)):mode===1?1:roundTo(rand(1.15,1.7));
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
        question='Estimate damping ratio ζ and natural frequency ωn. The curve may or may not overshoot.';
        hint='For an underdamped response, overshoot depends on ζ and peak time depends on both ζ and ωn. For no-overshoot responses, inspect how quickly the curve rises and whether it has a repeated pole (critical damping).';
        fields=[['zeta','Damping ratio ζ',''],['wn','Natural frequency ωn','rad/s']];
      }
      $('roundName').textContent=roundName;$('roundHint').textContent=roundHint;
      $('question').textContent=question;$('hintText').textContent=hint;
      $('fields').innerHTML=fields.map(([id,label,unit])=>`<div class="field"><label for="${id}">${label}${unit?` (${unit})`:''}</label><input type="number" id="${id}" name="${id}" min="0.001" step="any" required placeholder="Your estimate" /></div>`).join('');
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
  