const presetPatients = [
  { severity: 9.1, respiratory: 2, vital: 2.4, warning: 1.2 },
  { severity: 6.8, respiratory: 1.4, vital: 1.6, warning: 0 },
  { severity: 4.7, respiratory: 0.7, vital: 0.8, warning: 0 },
  { severity: 2.9, respiratory: 0, vital: 0.8, warning: 0 },
  { severity: 1.4, respiratory: 0, vital: 0, warning: 0 }
];

const unitDefaults = [
  { id: "icu", name: "ICU", capacity: 2, serviceRate: 8, initialWait: 0.35, idealSeverity: 9.2, bias: 0.35, color: "#ff6b8a" },
  { id: "er", name: "ER", capacity: 4, serviceRate: 10, initialWait: 0.25, idealSeverity: 5.4, bias: 0.15, color: "#38d8ff" },
  { id: "fastTrack", name: "Fast Track", capacity: 5, serviceRate: 15, initialWait: 0.12, idealSeverity: 2.1, bias: 0.1, color: "#4ee0a5" }
];

let patients = [];
let units = structuredClone(unitDefaults);
let patientSequence = 1;

const dataSourceInputs = document.querySelectorAll("input[name='data-source']");
const presetActions = document.getElementById("presetActions");
const patientForm = document.getElementById("patientForm");
const unitConfig = document.getElementById("unitConfig");
const patientTableBody = document.getElementById("patientTableBody");
const queueList = document.getElementById("queueList");
const severityWeight = document.getElementById("severityWeight");
const waitWeight = document.getElementById("waitWeight");
const deteriorationRate = document.getElementById("deteriorationRate");

const outputs = {
  severityWeight: document.getElementById("severityWeightOut"),
  waitWeight: document.getElementById("waitWeightOut"),
  deteriorationRate: document.getElementById("deteriorationRateOut"),
  totalPatients: document.getElementById("totalPatients"),
  criticalPatients: document.getElementById("criticalPatients"),
  congestedUnit: document.getElementById("congestedUnit"),
  deterioratedPatients: document.getElementById("deterioratedPatients")
};

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function round(value, digits = 2) {
  return Number.parseFloat(value).toFixed(digits);
}

function mapSeverityToEsi(severity) {
  if (severity >= 8) return "1-2";
  if (severity >= 6) return "2-3";
  if (severity >= 4) return "3";
  if (severity >= 2) return "4";
  return "5";
}

function getEsiClass(severity) {
  if (severity >= 6) return "critical";
  if (severity >= 4) return "moderate";
  return "minor";
}

function makePatient(data) {
  const clinicalFactor = Number(data.respiratory) + Number(data.vital) + Number(data.warning);
  const severity = clamp(Number(data.severity) + clinicalFactor * 0.25, 0, 10);

  return {
    id: `patient-${patientSequence++}`,
    severity,
    respiratory: Number(data.respiratory),
    vital: Number(data.vital),
    warning: Number(data.warning)
  };
}

function renderUnitConfig() {
  unitConfig.innerHTML = units.map((unit) => `
    <div class="unit-card" data-unit="${unit.id}">
      <div class="unit-name">
        <span class="unit-dot" style="background:${unit.color}"></span>
        ${unit.name}
      </div>
      <label>
        Capacity
        <input type="number" min="1" max="30" step="1" value="${unit.capacity}" data-field="capacity">
      </label>
      <label>
        Service Rate
        <input type="number" min="0.1" max="30" step="0.1" value="${unit.serviceRate}" data-field="serviceRate">
      </label>
      <label>
        Initial Wait
        <input type="number" min="0" max="10" step="0.05" value="${unit.initialWait}" data-field="initialWait">
      </label>
    </div>
  `).join("");
}

function softmax(utilities) {
  const maxUtility = Math.max(...utilities);
  const exponentials = utilities.map((value) => Math.exp(value - maxUtility));
  const total = exponentials.reduce((sum, value) => sum + value, 0);

  return exponentials.map((value) => value / total);
}

function calculateSimulation() {
  const severityBeta = Number(severityWeight.value);
  const waitBeta = Number(waitWeight.value);
  const deteriorationBeta = Number(deteriorationRate.value);
  const queues = units.map((unit) => ({
    ...unit,
    assigned: [],
    arrivalRate: 0,
    waitingTime: unit.initialWait,
    congestion: 0
  }));

  const results = patients.map((patient) => {
    const utilities = queues.map((unit) => {
      const severityCompatibility = 10 - Math.abs(patient.severity - unit.idealSeverity);
      const congestion = unit.assigned.length / unit.capacity;
      return severityBeta * severityCompatibility - waitBeta * unit.waitingTime - congestion + unit.bias;
    });

    const probabilities = softmax(utilities);
    const bestIndex = probabilities.indexOf(Math.max(...probabilities));
    const assignedUnit = queues[bestIndex];

    assignedUnit.assigned.push(patient.id);
    assignedUnit.arrivalRate = assignedUnit.assigned.length;
    assignedUnit.congestion = assignedUnit.assigned.length / assignedUnit.capacity;
    assignedUnit.waitingTime = calculateWaitingTime(assignedUnit);

    const patientWait = assignedUnit.waitingTime;
    const updatedSeverity = clamp(patient.severity + deteriorationBeta * patientWait, 0, 10);

    return {
      ...patient,
      esi: mapSeverityToEsi(patient.severity),
      probabilities,
      assignedUnit: assignedUnit.name,
      wait: patientWait,
      updatedSeverity,
      updatedEsi: mapSeverityToEsi(updatedSeverity),
      deteriorated: updatedSeverity - patient.severity >= 0.25
    };
  });

  return { results, queues };
}

function calculateWaitingTime(unit) {
  const effectiveServiceRate = unit.serviceRate * unit.capacity;
  const load = unit.assigned.length;
  const denominator = Math.max(effectiveServiceRate - load, 0.2);
  return unit.initialWait + load / denominator;
}

function renderProbability(probability) {
  const percent = Math.round(probability * 100);
  return `
    <div class="probability">
      ${percent}%
      <div class="probability-bar" aria-hidden="true">
        <div class="probability-fill" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

function renderPatients(results) {
  if (!results.length) {
    patientTableBody.innerHTML = `<tr><td colspan="10" class="empty-state">No patient records yet.</td></tr>`;
    return;
  }

  patientTableBody.innerHTML = results.map((patient, index) => `
    <tr>
      <td><strong>Patient ${index + 1}</strong></td>
      <td>${round(patient.severity)}</td>
      <td><span class="badge ${getEsiClass(patient.severity)}">ESI ${patient.esi}</span></td>
      <td>${renderProbability(patient.probabilities[0])}</td>
      <td>${renderProbability(patient.probabilities[1])}</td>
      <td>${renderProbability(patient.probabilities[2])}</td>
      <td><strong>${patient.assignedUnit}</strong></td>
      <td>${round(patient.wait)} hr</td>
      <td>${round(patient.updatedSeverity)}</td>
      <td><span class="badge ${getEsiClass(patient.updatedSeverity)}">ESI ${patient.updatedEsi}</span></td>
    </tr>
  `).join("");
}

function renderQueues(queues) {
  queueList.innerHTML = queues.map((unit) => {
    const capacityPercent = Math.min(Math.round(unit.congestion * 100), 160);
    const congestionLabel = unit.congestion >= 1 ? "Full" : unit.congestion >= 0.75 ? "High" : "Stable";

    return `
      <article class="queue-card">
        <h3>${unit.name}</h3>
        <div class="queue-metrics">
          <div>
            <span>Patients</span>
            <strong>${unit.assigned.length}/${unit.capacity}</strong>
          </div>
          <div>
            <span>Arrival Rate</span>
            <strong>${unit.arrivalRate}</strong>
          </div>
          <div>
            <span>Service Rate</span>
            <strong>${unit.serviceRate}</strong>
          </div>
          <div>
            <span>Waiting Time</span>
            <strong>${round(unit.waitingTime)} hr</strong>
          </div>
        </div>
        <div class="capacity-bar" title="${congestionLabel}">
          <div class="capacity-fill" style="width:${Math.min(capacityPercent, 100)}%"></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderSummary(results, queues) {
  const criticalCount = results.filter((patient) => patient.severity >= 6).length;
  const deterioratedCount = results.filter((patient) => patient.deteriorated).length;
  const mostCongested = queues.reduce((highest, unit) => (
    unit.congestion > highest.congestion ? unit : highest
  ), queues[0]);

  outputs.totalPatients.textContent = results.length;
  outputs.criticalPatients.textContent = criticalCount;
  outputs.congestedUnit.textContent = results.length ? mostCongested.name : "None";
  outputs.deterioratedPatients.textContent = deterioratedCount;
}

function renderAll() {
  outputs.severityWeight.textContent = Number(severityWeight.value).toFixed(1);
  outputs.waitWeight.textContent = Number(waitWeight.value).toFixed(1);
  outputs.deteriorationRate.textContent = Number(deteriorationRate.value).toFixed(2);

  const { results, queues } = calculateSimulation();
  renderPatients(results);
  renderQueues(queues);
  renderSummary(results, queues);
}

function setDataSource(source) {
  const customMode = source === "custom";
  patientForm.classList.toggle("hidden", !customMode);
  presetActions.classList.toggle("hidden", customMode);

  if (customMode) {
    patients = [];
  } else {
    loadPresetPatients();
  }

  renderAll();
}

function loadPresetPatients() {
  patients = presetPatients.map(makePatient);
}

function resetSimulation() {
  units = structuredClone(unitDefaults);
  loadPresetPatients();
  severityWeight.value = "1.1";
  waitWeight.value = "0.5";
  deteriorationRate.value = "0.3";
  renderUnitConfig();
  renderAll();
}

dataSourceInputs.forEach((input) => {
  input.addEventListener("change", (event) => setDataSource(event.target.value));
});

document.getElementById("loadPresetBtn").addEventListener("click", () => {
  loadPresetPatients();
  renderAll();
});

document.getElementById("resetBtn").addEventListener("click", resetSimulation);

document.getElementById("clearPatientsBtn").addEventListener("click", () => {
  patients = [];
  renderAll();
});

patientForm.addEventListener("submit", (event) => {
  event.preventDefault();

  patients.push(makePatient({
    severity: document.getElementById("severityInput").value,
    respiratory: document.getElementById("respiratoryInput").value,
    vital: document.getElementById("vitalInput").value,
    warning: document.getElementById("warningInput").value
  }));

  event.target.reset();
  document.getElementById("severityInput").value = "5.5";
  renderAll();
});

unitConfig.addEventListener("input", (event) => {
  const card = event.target.closest(".unit-card");
  if (!card) return;

  const unit = units.find((item) => item.id === card.dataset.unit);
  unit[event.target.dataset.field] = Number(event.target.value);
  renderAll();
});

[severityWeight, waitWeight, deteriorationRate].forEach((input) => {
  input.addEventListener("input", renderAll);
});

renderUnitConfig();
loadPresetPatients();
renderAll();
