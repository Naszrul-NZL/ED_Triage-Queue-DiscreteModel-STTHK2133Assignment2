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

let patients = [];
let units = [];
let currentTime = 0;
let history = [];
let escalationEvents = [];
let dataSource = "preset";

const elements = {
  currentTick: document.getElementById("currentTick"),
  totalPatients: document.getElementById("totalPatients"),
  averageSeverity: document.getElementById("averageSeverity"),
  totalEscalations: document.getElementById("totalEscalations"),
  highestRiskPatient: document.getElementById("highestRiskPatient"),
  currentPatientBody: document.getElementById("currentPatientBody"),
  unitQueueList: document.getElementById("unitQueueList"),
  historyBody: document.getElementById("historyBody"),
  escalationLog: document.getElementById("escalationLog"),
  presetControls: document.getElementById("presetControls"),
  patientForm: document.getElementById("patientForm")
};

function makePatient(data, index) {
  const severity = clamp(Number(data.severity), 0, 10);
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function getUnit(unitId) {
  return units.find((unit) => unit.id === unitId);
}

function updateUnitWaitingTimes() {
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

function chooseUnit(patient) {
  const utilities = units.map((unit) => computeUtility(patient, unit));
  const probabilities = softmax(utilities);
  const bestIndex = probabilities.indexOf(Math.max(...probabilities));

  patient.lastUtilities = utilities;
  patient.lastProbabilities = probabilities;

  return units[bestIndex].id;
}

function assignPatient(patient, unitId) {
  if (patient.assignedUnit) {
    const oldUnit = getUnit(patient.assignedUnit);
    oldUnit.patientIds = oldUnit.patientIds.filter((id) => id !== patient.id);
  }

  const newUnit = getUnit(unitId);
  newUnit.patientIds.push(patient.id);
  patient.assignedUnit = unitId;
  updateUnitWaitingTimes();
}

function initializeSimulation(sourcePatients = PRESET_PATIENTS) {
  units = makeUnits();
  currentTime = 0;
  history = [];
  escalationEvents = [];
  patients = sourcePatients.map(makePatient);

  patients.forEach((patient) => {
    const unitId = chooseUnit(patient);
    assignPatient(patient, unitId);
  });

  patients.forEach((patient) => {
    patient.waitTime = 0;
    patient.currentSeverity = patient.severityInitial;
    patient.currentEsi = patient.initialEsi;
    patient.note = "Stable - no change";
  });

  logCurrentState();
  render();
}

function restartCurrentSimulation() {
  const sourcePatients = patients.map((patient) => ({
    age: patient.age,
    severity: patient.severityInitial
  }));

  initializeSimulation(sourcePatients.length ? sourcePatients : PRESET_PATIENTS);
}

function advanceOneHour() {
  if (!patients.length) return;

  currentTime += 1;

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
      const newUnitId = chooseUnit(patient);
      if (newUnitId !== previousUnit) {
        assignPatient(patient, newUnitId);
        patient.note = `ESCALATED ESI ${previousEsi} -> ${patient.currentEsi}; reassigned to ${getUnit(newUnitId).name}`;
      } else {
        patient.note = `ESCALATED ESI ${previousEsi} -> ${patient.currentEsi}; unit unchanged`;
      }

      escalationEvents.push({
        time: currentTime,
        patient: patient.label,
        oldEsi: previousEsi,
        newEsi: patient.currentEsi,
        severity: patient.currentSeverity,
        action: patient.note
      });
    }
  });

  updateUnitWaitingTimes();
  logCurrentState();
  render();
}

function runHours(hours) {
  for (let i = 0; i < hours; i += 1) {
    advanceOneHour();
  }
}

function logCurrentState() {
  patients.forEach((patient) => {
    const unit = getUnit(patient.assignedUnit);
    history.push({
      time: currentTime,
      patient: patient.label,
      severityInitial: patient.severityInitial,
      currentSeverity: patient.currentSeverity,
      esi: patient.currentEsi,
      unit: unit.name,
      waitingTime: unit.waitingTime,
      note: patient.note
    });
  });
}

function render() {
  elements.currentTick.textContent = `t = ${currentTime}`;
  renderMetrics();
  renderPatients();
  renderUnits();
  renderHistory();
  renderEscalations();
}

function renderMetrics() {
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
  if (!patients.length) {
    elements.currentPatientBody.innerHTML = `<tr><td colspan="10" class="empty-state">No patient records yet.</td></tr>`;
    return;
  }

  elements.currentPatientBody.innerHTML = patients.map((patient) => {
    const unit = getUnit(patient.assignedUnit);
    const escalated = patient.note.startsWith("ESCALATED");

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
            <span>n_j</span>
            <strong>${unit.occupancy}</strong>
          </div>
          <div>
            <span>Capacity C_j</span>
            <strong>${unit.capacity}</strong>
          </div>
          <div>
            <span>mu_j</span>
            <strong>${unit.serviceRate} pt/hr</strong>
          </div>
          <div>
            <span>Wq = n_j / mu_j</span>
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

function renderHistory() {
  if (!history.length) {
    elements.historyBody.innerHTML = `<tr><td colspan="8" class="empty-state">No hourly records yet.</td></tr>`;
    return;
  }

  elements.historyBody.innerHTML = history.map((row) => `
    <tr class="${row.note.startsWith("ESCALATED") ? "highlight-row" : ""}">
      <td>t = ${row.time}</td>
      <td><strong>${row.patient}</strong></td>
      <td>${formatNumber(row.severityInitial)}</td>
      <td>${formatNumber(row.currentSeverity)}</td>
      <td><span class="badge ${getEsiClass(row.esi)}">ESI ${row.esi}</span></td>
      <td>${row.unit}</td>
      <td>${formatNumber(row.waitingTime)} hr</td>
      <td>${row.note}</td>
    </tr>
  `).join("");
}

function renderEscalations() {
  if (!escalationEvents.length) {
    elements.escalationLog.innerHTML = `<p class="empty-state">No ESI escalation has occurred yet.</p>`;
    return;
  }

  elements.escalationLog.innerHTML = escalationEvents.map((event) => `
    <article class="log-card">
      <h3>${event.patient}</h3>
      <span>Hour</span>
      <strong>t = ${event.time}</strong>
      <span>Change</span>
      <strong>ESI ${event.oldEsi} -> ESI ${event.newEsi}</strong>
      <span>Severity</span>
      <strong>${formatNumber(event.severity)}</strong>
      <span>Action</span>
      <strong>${event.action}</strong>
    </article>
  `).join("");
}

document.querySelectorAll("input[name='dataSource']").forEach((input) => {
  input.addEventListener("change", (event) => {
    dataSource = event.target.value;
    const customMode = dataSource === "custom";
    elements.patientForm.classList.toggle("hidden", !customMode);
    elements.presetControls.classList.toggle("hidden", customMode);

    if (customMode) {
      patients = [];
      units = makeUnits();
      currentTime = 0;
      history = [];
      escalationEvents = [];
      render();
    } else {
      initializeSimulation(PRESET_PATIENTS);
    }
  });
});

document.getElementById("loadPresetBtn").addEventListener("click", () => {
  dataSource = "preset";
  initializeSimulation(PRESET_PATIENTS);
});

document.getElementById("resetBtn").addEventListener("click", () => {
  initializeSimulation(PRESET_PATIENTS);
});

document.getElementById("restartBtn").addEventListener("click", restartCurrentSimulation);

document.getElementById("nextTickBtn").addEventListener("click", advanceOneHour);

document.getElementById("runFiveBtn").addEventListener("click", () => runHours(5));

document.getElementById("clearPatientsBtn").addEventListener("click", () => {
  patients = [];
  units = makeUnits();
  currentTime = 0;
  history = [];
  escalationEvents = [];
  render();
});

document.getElementById("patientForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const newSource = patients.map((patient) => ({
    age: patient.age,
    severity: patient.severityInitial
  }));

  newSource.push({
    age: document.getElementById("ageInput").value,
    severity: document.getElementById("severityInput").value
  });

  initializeSimulation(newSource);
  event.target.reset();
  document.getElementById("ageInput").value = "40";
  document.getElementById("severityInput").value = "5.0";
});

initializeSimulation(PRESET_PATIENTS);
