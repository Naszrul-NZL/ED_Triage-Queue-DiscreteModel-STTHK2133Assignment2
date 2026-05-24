# Emergency Department Triage Time-Step Simulation

Static GitHub Pages web app for the STTHK2133 ED triage assignment.

## Source Files

- `index.html` - page structure
- `styles.css` - dark blue and dark purple interface theme
- `script.js` - simulation logic

## Model Used

- Fixed initial patient cohort, no continuous arrivals
- One simulation tick equals one hour
- ICU: capacity 2, service rate 1 patient/hour
- ER: capacity 3, service rate 3 patients/hour
- Fast Track: capacity 4, service rate 6 patients/hour
- Utility: `U*ij = (alpha x Si + beta x Wj) - gamma x (nj / Cj)`
- Constants: `alpha = 0.6`, `beta = -0.4`, `gamma = 0.5`, `delta = 0.1`
- SoftMax assignment with argmax selection
- Waiting time: `Wq = nj / muj`
- Deterioration: `St = Sinitial + (delta x wait_time)`

## GitHub Pages Deployment

Upload `index.html`, `styles.css`, `script.js`, and `README.md` to the root of a GitHub repository. Then enable GitHub Pages from the repository settings using the `main` branch and root folder.
