import { Card, CardHead, Pill } from "@/components/ui";

/** Plain statements for the card option. It is not built, so none of this names a vendor, a date, or a price. */
export const CARD_FUNDING_COPY = {
  title: "Pay with a card",
  status: "Coming soon",
  today: "Paying with a card is not available yet. Today an agent is funded by sending USDC from your own owner wallet, using the funding card.",
  option: "Pay with a card",
  note: "This option does nothing yet. No card or personal details are collected here.",
};

/**
 * The card option on the fund screen (ARCHITECTURE.md section 6.1): design only, not integrated. It is static text and one
 * disabled control. It makes no network call, collects nothing, links nowhere, and names no provider.
 */
export function CardFundingNotice() {
  return (
    <Card>
      <CardHead title={CARD_FUNDING_COPY.title}>
        <Pill tone="off">{CARD_FUNDING_COPY.status}</Pill>
      </CardHead>
      <p className="text-[13px] text-muted">{CARD_FUNDING_COPY.today}</p>
      <button type="button" className="btn mt-3 w-full sm:w-auto" disabled aria-disabled="true" aria-describedby="card-funding-note">
        {CARD_FUNDING_COPY.option}
      </button>
      <p id="card-funding-note" className="mt-2 text-xs text-muted">
        {CARD_FUNDING_COPY.note}
      </p>
    </Card>
  );
}
