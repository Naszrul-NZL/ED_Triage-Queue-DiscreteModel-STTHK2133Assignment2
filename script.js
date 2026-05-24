const MODEL = { alpha: 0.6, beta: -0.4, gamma: 0.5, delta: 0.1 };

const UNIT_TEMPLATE = [
  { id: "ICU", name: "ICU", capacity: 2, serviceRate: 1 },
  { id: "ER", name: "ER", capacity: 3, serviceRate: 3 },
  { id: "FAST_TRACK", name: "Fast Track", capacity: 4, serviceRate: 6 }
];

const PRESET_PATIENTS = [
  { age: 62, severity: 8.5 },
  { age: 45, severity: 7.2 },
  { age: 33, severity: 5.1 },
  { age: 28, severity: 3.4 },
  { age: 55, severity: 1.8 },
  { age: 70, severity: 6.5 },
  { age: 41, severity: 4.3 }
];

const PATIENT_COLORS = ["#37d5ff", "#9d6dff", "#ef5ccc", "#52e0a4", "#ffd166", "#ff6d8d", "#7aa2ff"];
const PATHWAY_COLORS = { ICU: "#1f8cc9", ER: "#e4511e", FAST_TRACK: "#efb21d" };

let sourcePatients = PRESET_PATIENTS.map((patient) => ({ ...patient }));
let selectedHour = 0;
let maxHour = 24;
let currentResult;

const $ = (id) => document.getElementById(id);
const elements = {
  currentHourLabel: $("currentHourLabel"),
  selectedHourBig: $("selectedHourBig"),
  hourSlider: $("hourSlider"),
  hourInput: $("hourInput"),
  sliderRangeLabel: $("sliderRangeLabel"),
  totalPatients: $("totalPatients"),
  averageSeverity: $("averageSeverity"),
  totalEscalations: $("totalEscalations"),
  highestRiskPatient: $("highestRiskPatient"),
  patientTableBody: $("patientTableBody"),
  unitQueueList: $("unitQueueList"),
  escalationLog: $("escalationLog"),
  chartLegend: $("chartLegend"),
  pathwayChart: $("pathwayChart"),
  severityChart: $("severityChart"),
  queueChart: $("queueChart"),
  patientForm: $("patientForm"),
  presetControls: $("presetControls")
};

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function mapSeverityToEsi(severity) {
  if (severity >= 8) return "1-2";
  if (severity >= 6) return "2-3";
  if (severity >= 4) return "3";
  if (severity >= 2) return "4";
  return "5";
}

function getEsiClass(esi) {
  if (esi === "1-2" || esi === "2-3") return "critical";
  if (esi === "3") return "moderate";
  return "minor";
}

function makePatient(data, index) {
  const severity = clamp(data.severity, 0, 10);
  const initialEsi = mapSeverityToEsi(severity);
  return {
    id: `P${String(index + 1).padStart(3, "0")}`,
    label: `Patient ${index + 1}`,
    age: Number(data.age),
    severityInitial: severity,
    currentSeverity: severity,
    initialEsi,
    currentEsi: initialEsi,
    assignedUnit: "",
    waitTime: 0,
    status: "WAITING",
    note: "Stable - no change",
    lastEscalationHour: null,
    lastProbabilities: [0, 0, 0]
  };
}

function makeUnits() {
  return UNIT_TEMPLATE.map((unit) => ({ ...unit, occupancy: 0, waitingTime: 0, patientIds: [] }));
}

function updateUnitWaitingTimes(units) {
  units.forEach((unit) => {
    unit.occupancy = unit.patientIds.length;
    unit.waitingTime = unit.occupancy / unit.serviceRate;
  });
}

function computeUtility(patient, unit) {
  return (MODEL.alpha * patient.currentSeverity + MODEL.beta * unit.waitingTime) -
    MODEL.gamma * (unit.occupancy / unit.capacity);
}

function softmax(values) {
  const maxValue = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maxValue));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function chooseUnit(patient, units) {
  const probabilities = softmax(units.map((unit) => computeUtility(patient, unit)));
  patient.lastProbabilities = probabilities;
  return units[probabilities.indexOf(Math.max(...probabilities))].id;
}

function getUnit(units, unitId) {
  return units.find((unit) => unit.id === unitId);
}

function assignPatient(patient, unitId, units) {
  if (patient.assignedUnit) {
    const oldUnit = getUnit(units, patient.assignedUnit);
    oldUnit.patientIds = oldUnit.patientIds.filter((id) => id !== patient.id);
  }
  getUnit(units, unitId).patientIds.push(patient.id);
  patient.assignedUnit = unitId;
  updateUnitWaitingTimes(units);
}

function captureSeverityPoint(series, patients, hour) {
  patients.forEach((patient, index) => {
    series[index].points.push({ hour, severity: patient.currentSeverity });
  });
}

function simulateToHour(targetHour) {
  const units = makeUnits();
  const patients = sourcePatients.map(makePatient);
  const escalationEvents = [];
  const severitySeries = patients.map((patient, index) => ({
    patient: patient.label,
    color: PATIENT_COLORS[index % PATIENT_COLORS.length],
    points: []
  }));

  patients.forEach((patient) => assignPatient(patient, chooseUnit(patient, units), units));
  captureSeverityPoint(severitySeries, patients, 0);

  for (let hour = 1; hour <= targetHour; hour += 1) {
    patients.forEach((patient) => {
      const previousEsi = patient.currentEsi;
      const previousUnit = patient.assignedUnit;
      patient.waitTime += 1;
      patient.currentSeverity = clamp(patient.severityInitial + MODEL.delta * patient.waitTime, 0, 10);
      patient.currentEsi = mapSeverityToEsi(patient.currentSeverity);
      patient.note = "Stable - no change";

      if (patient.currentEsi !== previousEsi) {
        const newUnitId = chooseUnit(patient, units);
        patient.lastEscalationHour = hour;
        if (newUnitId !== previousUnit) {
          assignPatient(patient, newUnitId, units);
          patient.note = `Escalated at Hour ${hour}: ESI ${previousEsi} to ${patient.currentEsi}, reassigned to ${getUnit(units, newUnitId).name}`;
        } else {
          patient.note = `Escalated at Hour ${hour}: ESI ${previousEsi} to ${patient.currentEsi}, unit unchanged`;
        }
        escalationEvents.push({ hour, patient: patient.label, oldEsi: previousEsi, newEsi: patient.currentEsi, severity: patient.currentSeverity, action: patient.note });
      }
    });
    updateUnitWaitingTimes(units);
    captureSeverityPoint(severitySeries, patients, hour);
  }

  patients.forEach((patient) => {
    if (patient.lastEscalationHour && !patient.note.startsWith("Escalated")) {
      patient.note = `Escalated earlier at Hour ${patient.lastEscalationHour}`;
    }
  });

  return { hour: targetHour, patients, units, escalationEvents, severitySeries };
}

function syncTimeControls() {
  elements.currentHourLabel.textContent = `Hour ${selectedHour}`;
  elements.selectedHourBig.textContent = selectedHour;
  elements.hourSlider.max = maxHour;
  elements.hourSlider.value = selectedHour;
  elements.hourInput.value = selectedHour;
  elements.sliderRangeLabel.textContent = `0-${maxHour}`;
}

function setSelectedHour(hour) {
  selectedHour = Math.max(0, Math.round(Number(hour) || 0));
  if (selectedHour > maxHour) maxHour = selectedHour;
  currentResult = simulateToHour(selectedHour);
  syncTimeControls();
  render();
}

function render() {
  renderMetrics();
  renderPatients();
  renderUnits();
  renderEscalations();
  drawPathwayChart();
  drawSeverityChart();
  drawQueueChart();
}

function renderMetrics() {
  const { patients, escalationEvents } = currentResult;
  const averageSeverity = patients.length ? patients.reduce((sum, p) => sum + p.currentSeverity, 0) / patients.length : 0;
  const highestRisk = patients.reduce((highest, patient) => !highest || patient.currentSeverity > highest.currentSeverity ? patient : highest, null);
  elements.totalPatients.textContent = patients.length;
  elements.averageSeverity.textContent = formatNumber(averageSeverity);
  elements.totalEscalations.textContent = escalationEvents.length;
  elements.highestRiskPatient.textContent = highestRisk ? highestRisk.label : "None";
}

function renderPatients() {
  const { patients, units } = currentResult;
  if (!patients.length) {
    elements.patientTableBody.innerHTML = `<tr><td colspan="10" class="empty">No patient records yet.</td></tr>`;
    return;
  }
  elements.patientTableBody.innerHTML = patients.map((patient) => {
    const unit = getUnit(units, patient.assignedUnit);
    return `
      <tr class="${patient.note.startsWith("Escalated") ? "highlight-row" : ""}">
        <td><strong>${patient.label}</strong></td>
        <td>${patient.age}</td>
        <td>${formatNumber(patient.severityInitial)}</td>
        <td>${formatNumber(patient.currentSeverity)}</td>
        <td><span class="badge ${getEsiClass(patient.initialEsi)}">ESI ${patient.initialEsi}</span></td>
        <td><span class="badge ${getEsiClass(patient.currentEsi)}">ESI ${patient.currentEsi}</span></td>
        <td><strong>${unit.name}</strong></td>
        <td>${patient.waitTime} hr</td>
        <td>${formatNumber(unit.waitingTime)} hr</td>
        <td>${patient.note}</td>
      </tr>
    `;
  }).join("");
}

function renderUnits() {
  const { units, patients } = currentResult;
  elements.unitQueueList.innerHTML = units.map((unit) => {
    const capacityPercent = Math.min((unit.occupancy / unit.capacity) * 100, 100);
    const patientLabels = unit.patientIds.map((id) => patients.find((p) => p.id === id)?.label).filter(Boolean).join(", ") || "None";
    return `
      <article class="unit-card">
        <h3>${unit.name}</h3>
        <div class="unit-metrics">
          <div><span>n</span><strong>${unit.occupancy}</strong></div>
          <div><span>Capacity</span><strong>${unit.capacity}</strong></div>
          <div><span>mu</span><strong>${unit.serviceRate} pt/hr</strong></div>
          <div><span>Wq</span><strong>${formatNumber(unit.waitingTime)} hr</strong></div>
        </div>
        <div class="capacity-bar"><div class="capacity-fill" style="width:${capacityPercent}%"></div></div>
        <p class="unit-patients">${patientLabels}</p>
      </article>
    `;
  }).join("");
}

function renderEscalations() {
  const { escalationEvents } = currentResult;
  if (!escalationEvents.length) {
    elements.escalationLog.innerHTML = `<p class="empty">No ESI escalation has occurred by Hour ${selectedHour}.</p>`;
    return;
  }
  elements.escalationLog.innerHTML = escalationEvents.map((event) => `
    <article class="log-card">
      <h3>${event.patient}</h3>
      <span>Hour</span><strong>Hour ${event.hour}</strong>
      <span>Change</span><strong>ESI ${event.oldEsi} to ESI ${event.newEsi}</strong>
      <span>Severity</span><strong>${formatNumber(event.severity)}</strong>
      <span>Action</span><strong>${event.action}</strong>
    </article>
  `).join("");
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(320, Math.round(rect.width || canvas.clientWidth || canvas.width));
  const cssHeight = Math.max(260, Math.round(rect.height || canvas.clientHeight || canvas.height));
  const scale = window.devicePixelRatio || 1;
  canvas.width = cssWidth * scale;
  canvas.height = cssHeight * scale;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

function drawBase(ctx, width, height, padding, yMax, xLabels, yDigits = 1) {
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071126";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(185, 194, 223, 0.2)";
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, sans-serif";
  ctx.fillStyle = "#bac3df";
  for (let i = 0; i <= 5; i += 1) {
    const value = yMax * i / 5;
    const y = padding.top + chartHeight - value / yMax * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(formatNumber(value, yDigits), 12, y + 4);
  }
  xLabels.forEach((label, index) => {
    const x = padding.left + (xLabels.length === 1 ? 0.5 : index / (xLabels.length - 1)) * chartWidth;
    ctx.fillText(label, x - 8, height - 18);
  });
  return { chartWidth, chartHeight };
}

function drawPathwayChart() {
  const { patients } = currentResult;
  const { ctx, width, height } = setupCanvas(elements.pathwayChart);
  const padding = { top: 42, right: 28, bottom: 62, left: 54 };
  const labels = patients.map((_, index) => String(index + 1));
  const { chartWidth, chartHeight } = drawBase(ctx, width, height, padding, 1, labels, 1);

  if (!patients.length) {
    ctx.fillStyle = "#bac3df";
    ctx.font = "16px Inter, sans-serif";
    ctx.fillText("No patient data to plot.", padding.left, padding.top + 40);
    return;
  }

  const series = [
    { name: "ICU", color: PATHWAY_COLORS.ICU, values: patients.map((p) => p.lastProbabilities[0] || 0) },
    { name: "ER", color: PATHWAY_COLORS.ER, values: patients.map((p) => p.lastProbabilities[1] || 0) },
    { name: "Fast Track", color: PATHWAY_COLORS.FAST_TRACK, values: patients.map((p) => p.lastProbabilities[2] || 0) }
  ];

  series.forEach((item, seriesIndex) => {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    item.values.forEach((value, index) => {
      const x = padding.left + (patients.length === 1 ? 0.5 : index / (patients.length - 1)) * chartWidth;
      const y = padding.top + chartHeight - value * chartHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    item.values.forEach((value, index) => {
      const x = padding.left + (patients.length === 1 ? 0.5 : index / (patients.length - 1)) * chartWidth;
      const y = padding.top + chartHeight - value * chartHeight;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#071126";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = item.color;
      ctx.stroke();
    });

    ctx.fillStyle = item.color;
    ctx.font = "bold 14px Inter, sans-serif";
    ctx.fillText(item.name, width / 2 - 130 + seriesIndex * 105, 24);
  });

  ctx.fillStyle = "#bac3df";
  ctx.font = "13px Inter, sans-serif";
  ctx.fillText("Patient Arrival Sequence", width / 2 - 78, height - 18);
  ctx.save();
  ctx.translate(18, height / 2 + 60);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Assignment Probability", 0, 0);
  ctx.restore();
}

function drawSeverityChart() {
  const { severitySeries } = currentResult;
  const { ctx, width, height } = setupCanvas(elements.severityChart);
  const padding = { top: 36, right: 28, bottom: 58, left: 54 };
  const visibleMaxHour = Math.max(selectedHour, 1);
  const step = Math.max(1, Math.ceil(visibleMaxHour / 6));
  const labels = [];
  for (let h = 0; h <= visibleMaxHour; h += step) labels.push(`H${h}`);
  if (!labels.includes(`H${visibleMaxHour}`)) labels.push(`H${visibleMaxHour}`);
  const { chartWidth, chartHeight } = drawBase(ctx, width, height, padding, 10, labels, 0);

  [2, 4, 6, 8].forEach((threshold) => {
    const y = padding.top + chartHeight - threshold / 10 * chartHeight;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(239, 178, 29, 0.38)";
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  severitySeries.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    item.points.forEach((point, index) => {
      const x = padding.left + point.hour / visibleMaxHour * chartWidth;
      const y = padding.top + chartHeight - point.severity / 10 * chartHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const last = item.points[item.points.length - 1];
    const x = padding.left + last.hour / visibleMaxHour * chartWidth;
    const y = padding.top + chartHeight - last.severity / 10 * chartHeight;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  elements.chartLegend.innerHTML = severitySeries.map((item) => `
    <span class="legend-item"><span class="legend-dot" style="background:${item.color}"></span>${item.patient}</span>
  `).join("");
}

function drawQueueChart() {
  const { units } = currentResult;
  const { ctx, width, height } = setupCanvas(elements.queueChart);
  const padding = { top: 32, right: 28, bottom: 58, left: 54 };
  const maxWait = Math.max(1, ...units.map((unit) => unit.waitingTime));
  const { chartWidth, chartHeight } = drawBase(ctx, width, height, padding, maxWait, units.map((unit) => unit.name), 1);
  const barWidth = chartWidth / units.length * 0.5;
  units.forEach((unit, index) => {
    const xCenter = padding.left + chartWidth / units.length * (index + 0.5);
    const barHeight = unit.waitingTime / maxWait * chartHeight;
    const x = xCenter - barWidth / 2;
    const y = padding.top + chartHeight - barHeight;
    const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartHeight);
    gradient.addColorStop(0, "#37d5ff");
    gradient.addColorStop(1, "#9d6dff");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#f7f8ff";
    ctx.font = "bold 13px Inter, sans-serif";
    ctx.fillText(`${formatNumber(unit.waitingTime)}h`, x + 6, y - 8);
  });
}

document.querySelectorAll("input[name='dataSource']").forEach((input) => {
  input.addEventListener("change", (event) => {
    const customMode = event.target.value === "custom";
    elements.patientForm.classList.toggle("hidden", !customMode);
    elements.presetControls.classList.toggle("hidden", customMode);
    sourcePatients = customMode ? [] : PRESET_PATIENTS.map((patient) => ({ ...patient }));
    setSelectedHour(0);
  });
});

$("loadPresetBtn").addEventListener("click", () => {
  sourcePatients = PRESET_PATIENTS.map((patient) => ({ ...patient }));
  setSelectedHour(0);
});
$("resetBtn").addEventListener("click", () => {
  sourcePatients = PRESET_PATIENTS.map((patient) => ({ ...patient }));
  setSelectedHour(0);
});
$("clearPatientsBtn").addEventListener("click", () => {
  sourcePatients = [];
  setSelectedHour(0);
});
$("patientForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sourcePatients.push({
    age: Number($("ageInput").value),
    severity: Number($("severityInput").value)
  });
  event.target.reset();
  $("ageInput").value = "40";
  $("severityInput").value = "5.0";
  setSelectedHour(selectedHour);
});

elements.hourSlider.addEventListener("input", (event) => setSelectedHour(event.target.value));
elements.hourInput.addEventListener("input", (event) => setSelectedHour(event.target.value));
$("previousHourBtn").addEventListener("click", () => setSelectedHour(selectedHour - 1));
$("nextHourBtn").addEventListener("click", () => setSelectedHour(selectedHour + 1));
window.addEventListener("resize", () => render());

currentResult = simulateToHour(selectedHour);
syncTimeControls();
render();
