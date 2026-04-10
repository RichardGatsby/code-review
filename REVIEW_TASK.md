# Code Review Task — Interviewer Guide

This document is for the **interviewer**. It lists all deliberately planted issues in `server.ts` and how to evaluate the candidate's review.

---

## Instructions to Give the Candidate

> You've joined a team that inherited `server.ts` — a Node.js/Express API endpoint for an e-commerce platform's order system. A previous developer wrote it as a quick prototype and it was deployed to production without review. The endpoint handles order creation including stock management, discount/coupon logic, tax calculation, and email confirmation. It uses Kysely as the query builder with PostgreSQL.
>
> Review the code and write up your findings as if you were reviewing a pull request. For each issue: describe the problem, explain the impact, and suggest a fix. Prioritize by severity.
>
> You do not need to run the code. Spend **10 minutes**. You may reference documentation (Express, TypeScript, Kysely, Node.js docs, etc.) but do not use AI tools.

---


