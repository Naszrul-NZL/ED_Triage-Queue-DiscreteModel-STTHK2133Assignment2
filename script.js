const MODEL = {
  alpha: 0.6,
  beta: -0.4,
  gamma: 0.5,
  delta: 0.1
};

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

const CHART_COLORS = [
  "#37d5ff",
  "#9d6dff",
  "#ef5ccc",
  "#52e0a4",
  "#ffd166",
  "#ff6d8d",
  "#7aa2ff",
  "#c891ff",
  "#5df2d6",
  "#f7a35c"
];

let sourcePatients = PRESET_PATIENTS.map((patient) => ({ ...patient }));
let selectedHour = 0;
let maxHour = 24;
let currentResult = null;

const elements = {
  currentHourLabel: document.getElementById("currentHourLabel"),
  selectedHourBig: document.getElementById("selectedHourBig"),
  hourSlider: document.getElementById("hourSlider"),
  hourInput: document.getElementById("hourInput"),
  sliderRangeLabel: document.getElementById("sliderRangeLabel"),
  totalPatients: document.getElementById("totalPatients"),
  averageSeverity: document.getElementById("averageSeverity"),
  totalEscalations: document.getElementById("totalEscalations"),
  highestRiskPatient: document.getElementById("highestRiskPatient"),
  patientTableBody: document.getElementById("patientTableBody"),
  unitQueueList: document.getElementById("unitQueueList"),
  escalationLog: document.getElementById("escalationLog"),
  chartLegend: document.getElementById("chartLegend"),
  severityChart: document.getElementById("severityChart"),
  queueChart: document.getElementById("queueChart"),
  patientForm: document.getElementById("patientForm"),
  presetControls: document.getElementById("presetControls")
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
    arrivalTime: 0,
    severityInitial: severity,
    currentSeverity: severity,
    initialEsi,
    currentEsi: initialEsi,
    assignedUnit: "",
    waitTime: 0,
    status: "WAITING",
    note: "Stable - no change",
    lastEscalationHour: null,
    lastUtilities: [],
    lastProbabilities: []
  };
}

function makeUnits() {
  return UNIT_TEMPLATE.map((unit) => ({
    ...unit,
    occupancy: 0,
    waitingTime: 0,
    patientIds: []
  }));
}

function updateUnitWaitingTimes(units) {
  units.forEach((unit) => {
    unit.occupancy = unit.patientIds.length;
    unit.waitingTime = unit.occupancy / unit.serviceRate;
  });
}

function computeUtility(patient, unit) {
  return (
    MODEL.alpha * patient.currentSeverity +
    MODEL.beta * unit.waitingTime
  ) - MODEL.gamma * (unit.occupancy / unit.capacity);
}

function softmax(values) {
  const maxValue = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maxValue));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function chooseUnit(patient, units) {
  const utilities = units.map((unit) => computeUtility(patient, unit));
  const probabilities = softmax(utilities);
  const bestIndex = probabilities.indexOf(Math.max(...probabilities));

  patient.lastUtilities = utilities;
  patient.lastProbabilities = probabilities;

  return units[bestIndex].id;
}

function getUnit(units, unitId) {
  return units.find((unit) => unit.id === unitId);
}

function assignPatient(patient, unitId, units) {
  if (patient.assignedUnit) {
    const oldUnit = getUnit(units, patient.assignedUnit);
    oldUnit.patientIds = oldUnit.patientIds.filter((id) => id !== patient.id);
  }

  const newUnit = getUnit(units, unitId);
  newUnit.patientIds.push(patient.id);
  patient.assignedUnit = unitId;
  updateUnitWaitingTimes(units);
}

function captureSeriesPoint(series, patients, hour) {
  patients.forEach((patient, index) => {
    series[index].points.push({
      hour,
      severity: patient.currentSeverity,
      esi: patient.currentEsi
    });
  });
}

function simulateToHour(targetHour) {
  const units = makeUnits();
  const patients = sourcePatients.map(makePatient);
  const escalationEvents = [];
  const series = patients.map((patient, index) => ({
    patient: patient.label,
    color: CHART_COLORS[index % CHART_COLORS.length],
    points: []
  }));

  patients.forEach((patient) => {
    const unitId = chooseUnit(patient, units);
    assignPatient(patient, unitId, units);
  });

  captureSeriesPoint(series, patients, 0);

  for (let hour = 1; hour <= targetHour; hour += 1) {
    patients.forEach((patient) => {
      if (patient.status !== "WAITING") return;

      const previousEsi = patient.currentEsi;
      const previousUnit = patient.assignedUnit;

      patient.waitTime += 1;
      patient.currentSeverity = clamp(
        patient.severityInitial + MODEL.delta * patient.waitTime,
        0,
        10
      );
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

        escalationEvents.push({
          hour,
          patient: patient.label,
          oldEsi: previousEsi,
          newEsi: patient.currentEsi,
          severity: patient.currentSeverity,
          action: patient.note
        });
      }
    });

    updateUnitWaitingTimes(units);
    captureSeriesPoint(series, patients, hour);
  }

  patients.forEach((patient) => {
    if (patient.lastEscalationHour && !patient.note.startsWith("Escalated at Hour")) {
      patient.note = `Escalated earlier at Hour ${patient.lastEscalationHour}`;
    }
  });

  return { hour: targetHour, patients, units, escalationEvents, series };
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
  if (selectedHour > maxHour) {
    maxHour = selectedHour;
  }
  currentResult = simulateToHour(selectedHour);
  syncTimeControls();
  render();
}

function render() {
  renderMetrics();
  renderPatients();
  renderUnits();
  renderEscalations();
  drawSeverityChart();
  drawQueueChart();
}

function renderMetrics() {
  const { patients, escalationEvents } = currentResult;
  const totalSeverity = patients.reduce((sum, patient) => sum + patient.currentSeverity, 0);
  const averageSeverity = patients.length ? totalSeverity / patients.length : 0;
  const highestRisk = patients.reduce((highest, patient) => (
    !highest || patient.currentSeverity > highest.currentSeverity ? patient : highest
  ), null);

  elements.totalPatients.textContent = patients.length;
  elements.averageSeverity.textContent = formatNumber(averageSeverity);
  elements.totalEscalations.textContent = escalationEvents.length;
  elements.highestRiskPatient.textContent = highestRisk ? highestRisk.label : "None";
}

function renderPatients() {
  const { patients, units } = currentResult;

  if (!patients.length) {
    elements.patientTableBody.innerHTML = `<tr><td colspan="10" class="empty-state">No patient records yet.</td></tr>`;
    return;
  }

  elements.patientTableBody.innerHTML = patients.map((patient) => {
    const unit = getUnit(units, patient.assignedUnit);
    const escalated = patient.note.startsWith("Escalated");

    return `
      <tr class="${escalated ? "highlight-row" : ""}">
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
    const patientLabels = unit.patientIds
      .map((id) => patients.find((patient) => patient.id === id)?.label)
      .filter(Boolean)
      .join(", ") || "None";

    return `
      <article class="unit-card">
        <h3>${unit.name}</h3>
        <div class="unit-metrics">
          <div>
            <span>n</span>
            <strong>${unit.occupancy}</strong>
          </div>
          <div>
            <span>Capacity</span>
            <strong>${unit.capacity}</strong>
          </div>
          <div>
            <span>mu</span>
            <strong>${unit.serviceRate} pt/hr</strong>
          </div>
          <div>
            <span>Wq</span>
            <strong>${formatNumber(unit.waitingTime)} hr</strong>
          </div>
        </div>
        <div class="capacity-bar" aria-label="Unit occupancy">
          <div class="capacity-fill" style="width:${capacityPercent}%"></div>
        </div>
        <p class="unit-patients">${patientLabels}</p>
      </article>
    `;
  }).join("");
}

function renderEscalations() {
  const { escalationEvents } = currentResult;

  if (!escalationEvents.length) {
    elements.escalationLog.innerHTML = `<p class="empty-state">No ESI escalation has occurred by Hour ${selectedHour}.</p>`;
    return;
  }

  elements.escalationLog.innerHTML = escalationEvents.map((event) => `
    <article class="log-card">
      <h3>${event.patient}</h3>
      <span>Hour</span>
      <strong>Hour ${event.hour}</strong>
      <span>Change</span>
      <strong>ESI ${event.oldEsi} to ESI ${event.newEsi}</strong>
      <span>Severity</span>
      <strong>${formatNumber(event.severity)}</strong>
      <span>Action</span>
      <strong>${event.action}</strong>
    </article>
  `).join("");
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * scale));
  canvas.height = Math.max(260, Math.floor(rect.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { ctx, width: canvas.width / scale, height: canvas.height / scale };
}

function drawSeverityChart() {
  const { ctx, width, height } = setupCanvas(elements.severityChart);
  const { series } = currentResult;
  const padding = { top: 22, right: 18, bottom: 42, left: 46 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const visibleMaxHour = Math.max(selectedHour, 1);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071126";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(185, 194, 223, 0.18)";
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, sans-serif";
  ctx.fillStyle = "#b9c2df";

  for (let severity = 0; severity <= 10; severity += 2) {
    const y = padding.top + chartHeight - (severity / 10) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(String(severity), 12, y + 4);
  }

  for (let hour = 0; hour <= visibleMaxHour; hour += Math.max(1, Math.ceil(visibleMaxHour / 6))) {
    const x = padding.left + (hour / visibleMaxHour) * chartWidth;
    ctx.fillText(`H${hour}`, x - 8, height - 16);
  }

  const thresholds = [
    { y: 2, label: "ESI 4" },
    { y: 4, label: "ESI 3" },
    { y: 6, label: "ESI 2-3" },
    { y: 8, label: "ESI 1-2" }
  ];

  thresholds.forEach((threshold) => {
    const y = padding.top + chartHeight - (threshold.y / 10) * chartHeight;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(255, 209, 102, 0.35)";
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffd166";
    ctx.fillText(threshold.label, width - padding.right - 58, y - 5);
  });

  series.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();

    item.points.forEach((point, index) => {
      const x = padding.left + (point.hour / visibleMaxHour) * chartWidth;
      const y = padding.top + chartHeight - (point.severity / 10) * chartHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    const lastPoint = item.points[item.points.length - 1];
    const lastX = padding.left + (lastPoint.hour / visibleMaxHour) * chartWidth;
    const lastY = padding.top + chartHeight - (lastPoint.severity / 10) * chartHeight;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  elements.chartLegend.innerHTML = series.map((item) => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${item.color}"></span>
      ${item.patient}
    </span>
  `).join("");
}

function drawQueueChart() {
  const { ctx, width, height } = setupCanvas(elements.queueChart);
  const { units } = currentResult;
  const padding = { top: 24, right: 18, bottom: 48, left: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxWait = Math.max(1, ...units.map((unit) => unit.waitingTime));
  const barWidth = chartWidth / units.length * 0.58;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071126";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(185, 194, 223, 0.18)";
  ctx.fillStyle = "#b9c2df";
  ctx.font = "12px Inter, sans-serif";

  for (let i = 0; i <= 4; i += 1) {
    const value = (maxWait / 4) * i;
    const y = padding.top + chartHeight - (value / maxWait) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(formatNumber(value, 1), 8, y + 4);
  }

  units.forEach((unit, index) => {
    const xCenter = padding.left + chartWidth / units.length * (index + 0.5);
    const barHeight = (unit.waitingTime / maxWait) * chartHeight;
    const x = xCenter - barWidth / 2;
    const y = padding.top + chartHeight - barHeight;

    const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartHeight);
    gradient.addColorStop(0, "#37d5ff");
    gradient.addColorStop(1, "#9d6dff");

    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = "#f7f8ff";
    ctx.fillText(`${formatNumber(unit.waitingTime)}h`, x + 4, y - 8);
    ctx.fillStyle = "#b9c2df";
    ctx.fillText(unit.name, xCenter - 28, height - 18);
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

document.getElementById("loadPresetBtn").addEventListener("click", () => {
  sourcePatients = PRESET_PATIENTS.map((patient) => ({ ...patient }));
  setSelectedHour(0);
});

document.getElementById("resetBtn").addEventListener("click", () => {
  sourcePatients = PRESET_PATIENTS.map((patient) => ({ ...patient }));
  setSelectedHour(0);
});

document.getElementById("clearPatientsBtn").addEventListener("click", () => {
  sourcePatients = [];
  setSelectedHour(0);
});

document.getElementById("patientForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sourcePatients.push({
    age: Number(document.getElementById("ageInput").value),
    severity: Number(document.getElementById("severityInput").value)
  });
  event.target.reset();
  document.getElementById("ageInput").value = "40";
  document.getElementById("severityInput").value = "5.0";
  setSelectedHour(selectedHour);
});

elements.hourSlider.addEventListener("input", (event) => {
  setSelectedHour(event.target.value);
});

elements.hourInput.addEventListener("input", (event) => {
  setSelectedHour(event.target.value);
});

document.getElementById("previousHourBtn").addEventListener("click", () => {
  setSelectedHour(selectedHour - 1);
});

document.getElementById("nextHourBtn").addEventListener("click", () => {
  setSelectedHour(selectedHour + 1);
});

window.addEventListener("resize", () => {
  drawSeverityChart();
  drawQueueChart();
});

currentResult = simulateToHour(selectedHour);
syncTimeControls();
render();
