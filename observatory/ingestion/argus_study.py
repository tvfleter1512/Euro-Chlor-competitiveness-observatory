"""Argus 2023 study agent — licensed ECU cash-cost structure (member view only).

Reads the EU4 (DE/FR/BE/ES) average ECU cash cost by component from Argus Media
Consulting, "Study on the Cost Competitiveness of the European Chlor-Alkali
Industry", Final Report (June 2023, for Euro Chlor), Fig. 5-4 p.97, transcribed
into data/licensed/argus/ (gitignored: the report is licensed and this repo is
public). Power/salt/fixed are the chart's data labels; "other variable costs"
are unlabelled in the chart and were measured from bar heights (±3 EUR/t),
flagged quality_flag='estimated'.

Every row is redistribution_class='licensed'. raw_landing receives the file
manifest only, not the licensed values.
"""
import csv
from datetime import datetime, timezone

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import DATA_DIR

ARGUS_DIR = DATA_DIR / "licensed" / "argus"
ECU_FILE = ARGUS_DIR / "ecu_cash_cost_eu4.csv"
DATASET = "Argus 2023 Final Report, Fig 5-4 p.97 (EU4 average ECU cash cost)"


class ArgusStudyAgent(IngestionAgent):
    name = "argus_study"
    source = "Argus Media Consulting 2023 study (licensed)"

    def available(self):
        if not ECU_FILE.exists():
            return False, f"no Argus transcription at {ECU_FILE}"
        return True, ""

    def fetch(self):
        with open(ECU_FILE, newline="", encoding="utf-8") as fh:
            self._records = list(csv.DictReader(fh))
        return [(str(ECU_FILE), {"file": ECU_FILE.name, "rows": len(self._records)})]

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        return [SeriesRow(
            series_id="cost.ecu_cash_cost_argus",
            geo_id="EU4",
            period=rec["year"],
            period_start=period_start(rec["year"]),
            value=rec["value_eur_per_t_ecu"],
            unit="EUR/t ECU",
            source="Argus Media Consulting",
            source_dataset=DATASET,
            reference_period=rec["year"],
            retrieved_at=retrieved_at,
            band=rec["component"],
            price_basis="forecast" if int(rec["year"]) >= 2022 else "model",
            redistribution_class="licensed",
            quality_flag=rec["quality"],
        ) for rec in self._records]
