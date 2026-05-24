# Emergency Department Triage Time Explorer

Static GitHub Pages web app for the STTHK2133 ED triage assignment.

## Files

- `index.html`
- `styles.css`
- `script.js`

## Main Features

- Preset data and custom patient input
- Anonymous patient labels
- Uncapped hour input, so users can inspect Hour 100 or beyond
- Current patient state at selected hour
- Unit queue state using `Wq = n / mu`
- Severity trend graph
- Queue waiting chart
- Pathway selection probability chart similar to the Octave-style output

## Model

- `U = (0.6S - 0.4W) - 0.5(n/C)`
- `P = exp(U) / sum exp(U)`
- `S(t) = S0 + 0.1t`
- ICU: capacity 2, service rate 1
- ER: capacity 3, service rate 3
- Fast Track: capacity 4, service rate 6
