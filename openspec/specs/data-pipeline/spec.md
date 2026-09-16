# Data Pipeline Specification

## Purpose

Parse `ControlPases.xlsx` into `workspace/output/data.json` with normalized headers and America/Lima timestamps.

## Requirements

### Requirement: Excel ingestion and header normalization

The pipeline MUST read `ControlPases.xlsx` via relative Linux paths and MUST normalize headers through a validated header map, preserving nulls.

#### Scenario: Valid workbook converts

- GIVEN a valid workbook in `workspace/input/`
- WHEN the pipeline runs
- THEN `data.json` is written with all rows and normalized headers

#### Scenario: Header drift fails fast

- GIVEN a workbook with unknown or misspelled headers
- WHEN the pipeline runs
- THEN it exits non-zero listing unmapped headers and writes no partial output

### Requirement: Lima dates and data.json contract

The pipeline MUST emit ISO timestamps in America/Lima and MUST never log full data rows.

#### Scenario: Naive dates become Lima ISO

- GIVEN naive `DD/MM/YYYY HH:MM` cells
- WHEN normalized
- THEN output is Lima ISO and nulls stay null

#### Scenario: No production leak

- GIVEN a run with production data
- WHEN logging
- THEN logs contain counts and errors only, never row values
