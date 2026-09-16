# Change Export Specification

## Purpose

CSV download and Teams-summary copy from the results view.

## Requirements

### Requirement: CSV download

The system MUST export the current result set as a CSV download.

#### Scenario: Export filtered set

- GIVEN filtered results
- WHEN the user exports CSV
- THEN the file contains exactly those rows

#### Scenario: Empty export

- GIVEN zero results
- WHEN the user exports CSV
- THEN the file contains headers only

### Requirement: Teams-summary copy

The system MUST copy a plain-text summary of current results to the clipboard.

#### Scenario: Copy summary

- GIVEN visible results
- WHEN the user copies the summary
- THEN the clipboard holds one Ticket/App/window line per row

#### Scenario: Clipboard blocked

- GIVEN denied clipboard access
- WHEN the user copies the summary
- THEN inline fallback text is shown for manual copy
