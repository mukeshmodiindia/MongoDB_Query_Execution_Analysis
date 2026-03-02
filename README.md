# MongoDB Query Execution Analysis

A lightweight, dependency-free dashboard to:

- Review **top queries from MongoDB logs**.
- Highlight the query with highest impact based on **execution time + occurrences**.
- Analyze outputs from:
  - `explain()` / `queryPlanner`
  - `explain('executionStats')`
  - `explain('allPlansExecution')` (with warning in UI)
- Detect potential **redundant indexes** using `getIndexes()` (+ optional `$indexStats`).
- Surface practical tuning suggestions (indexing, query shape, selectivity, runtime checks).

## Run

No package install required.

```bash
python3 -m http.server 4173
```

Then open: `http://localhost:4173`

## Workflow

1. Paste MongoDB log lines in the **Top Query Review** section.
2. Click **Analyze Logs** to get grouped fingerprints, frequency, and timing dashboard.
3. Paste explain JSON output in **Explain Plan Analysis** and run analysis.
4. Paste index metadata in **Redundant Index Review**.

## Supported explain modes

- **queryPlanner** (`explain()`): optimizer choice without full execution metrics.
- **executionStats** (`explain('executionStats')`): includes runtime stats like docs/keys examined.
- **allPlansExecution** (`explain('allPlansExecution')`): includes candidate plan execution details; use carefully in production.

## MongoDB 6.0 / 7.0 / 8.0 alignment notes

The dashboard logic is written to be compatible with explain/index concepts available across MongoDB 6.0, 7.0, and 8.0:

- Explain verbosity modes are supported across these versions.
- `queryPlanner` and `executionStats` fields used by this tool are common and stable.
- Redundant index checks rely on `getIndexes()` and optional `$indexStats` data.

Before production usage, validate behavior against your exact patch version and official docs:

- https://www.mongodb.com/docs/v6.0/reference/explain-results/
- https://www.mongodb.com/docs/v7.0/reference/explain-results/
- https://www.mongodb.com/docs/v8.0/reference/explain-results/
- https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexStats/

## Input examples

### Logs
Use JSON log lines (recommended), especially slow query command entries.

### Explain
Paste raw explain output from mongosh, e.g.:

```javascript
db.orders.find({ status: "OPEN" }).explain("executionStats")
```

### Index metadata

```javascript
db.orders.getIndexes()
db.orders.aggregate([{ $indexStats: {} }])
```

You can paste index data as either:

- Array of index specs, or
- Object format with `indexes` and optional `usage` arrays.
