# Threat Report: [Feature Name]

> **Date:** YYYY-MM-DD
> **Feature:** Brief description of the feature under test
> **Test file:** Path to the test file
> **Tests added:** Number of adversarial tests

---

## Summary

One paragraph: what does this feature do, and why does it have an attack surface?

---

## Threat Matrix

For each threat, document:

### THREAT-N: [Short Name]

| Field | Value |
|---|---|
| **Severity** | Critical / High / Medium / Low |
| **Category** | Fund extraction, Race condition, Auth bypass, Phantom operation, Scope leakage, Auto-approval abuse, Guard bypass, Accidental amplification |
| **Attack scenario** | How would an attacker exploit this? Step by step. |
| **Defense mechanism** | What code prevents this? Which layer(s)? |
| **Test name** | `FEATURE-ADV: test name` |
| **Residual risk** | What's left unmitigated? "None" if fully covered. |

---

## Severity Guide

- **Critical** — Direct fund loss, position manipulation, or unauthorized trade execution. Would cause immediate financial harm.
- **High** — Could lead to fund loss under specific conditions (race window, stale state). Requires attacker sophistication.
- **Medium** — Data integrity issue that could mislead users or corrupt audit trail, but no direct fund movement.
- **Low** — UX issue, information leak, or edge case that degrades trust but doesn't move money.

---

## Architecture Notes

Any observations about the overall defensive posture: defense-in-depth layers, single points of failure, areas that could use hardening in future phases.
