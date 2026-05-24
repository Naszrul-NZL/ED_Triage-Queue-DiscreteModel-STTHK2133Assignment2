# Emergency Department Triage Time Explorer

Static GitHub Pages web app for the STTHK2133 ED triage assignment.

## Files

- `index.html` - page structure
- `styles.css` - dark blue and dark purple theme
- `script.js` - time-step simulation and chart logic

## System Model

- Fixed patient cohort, no continuous arrivals
- One tick equals one hour
- ICU: capacity 2, service rate 1 patient/hour
- ER: capacity 3, service rate 3 patients/hour
- Fast Track: capacity 4, service rate 6 patients/hour
- Utility: `U = (0.6S - 0.4W) - 0.5(n/C)`
- SoftMax assignment with argmax selection
- Waiting time: `Wq = n / mu`
- Deterioration: `S(t) = S0 + 0.1t`

## Website Features

- Preset patient data and custom patient data
- Anonymous labels: Patient 1, Patient 2, Patient 3, and so on
- Slider and number input to jump to any simulation hour
- Current patient state table for the selected hour
- Unit queue state for the selected hour
- Severity trend graph inside the website
- Queue waiting chart inside the website
- ESI escalation log up to the selected hour

## Deploy on GitHub Pages

Upload `index.html`, `styles.css`, `script.js`, and `README.md` to the root of a GitHub repository. Then enable GitHub Pages from the repository settings using the `main` branch and root folder.
