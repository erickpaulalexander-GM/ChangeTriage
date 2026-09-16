# Change Search Specification

## Purpose

Instant search, filters, and incident-overlap query over `data.json` for triage in under 10 seconds.

## Requirements

### Requirement: Instant search and filters

The system MUST provide instant substring search across Ticket, App, and Recurso with Ticket, App, Tipo, and Fecha filters.

#### Scenario: Ticket lookup

- GIVEN loaded `data.json`
- WHEN the user types a ticket fragment
- THEN matching rows appear instantly

#### Scenario: Combined filters narrow results

- GIVEN an active filter set
- WHEN filters are applied
- THEN only rows matching all filters are shown

### Requirement: Incident-overlap query

The system MUST flag rows where `impl_ini <= incident <= impl_fin`, evaluated in America/Lima.

#### Scenario: Overlap match

- GIVEN an incident datetime inside a change window
- WHEN queried in incident mode
- THEN the row is flagged overlapping

#### Scenario: No overlap

- GIVEN an incident datetime outside all windows
- WHEN queried in incident mode
- THEN rows are flagged non-overlapping
