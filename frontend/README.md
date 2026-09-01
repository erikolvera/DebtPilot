# DebtPilot frontend

An anonymous debt payoff calculator. Enter your credit cards and get a
payoff plan comparing the snowball and avalanche methods against a
minimums-only baseline — every figure comes from the Python backend; this
app only formats them.

## Running locally

The backend must be running (see `/backend`) and reachable at
`NEXT_PUBLIC_API_BASE_URL` (defaults to `http://127.0.0.1:8000`).

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
