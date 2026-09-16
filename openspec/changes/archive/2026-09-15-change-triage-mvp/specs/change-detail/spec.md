# Change Detail Specification

## Purpose

Six-group detail drawer for a selected change and an empty-state page when nothing matches.

## Requirements

### Requirement: Six-group detail drawer

The system MUST show a drawer with the 6 change groups for the selected row.

#### Scenario: Open drawer

- GIVEN a results list
- WHEN the user selects a row
- THEN the drawer shows all 6 groups for that change

#### Scenario: Close returns focus

- GIVEN an open drawer
- WHEN the user closes it
- THEN focus returns to the results list

### Requirement: Empty state

The system MUST render an empty-state page when no rows match, with a reset action.

#### Scenario: No results

- GIVEN filters matching nothing
- WHEN applied
- THEN the empty-state page shows with a reset action
