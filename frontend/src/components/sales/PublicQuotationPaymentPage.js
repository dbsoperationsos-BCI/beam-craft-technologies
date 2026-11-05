"use client";

import { useEffect, useMemo, useState } from "react";
import CheckRounded from "@mui/icons-material/CheckRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import ExpiredClientLink from "@/components/shared/ExpiredClientLink";
import DeviceViewport from "@/components/shared/DeviceViewport";
import { expiredLinkFrom } from "@/lib/expiredLink.mjs";
import AppLogo, { DocumentLogo } from "@/components/shared/AppLogo";
import Button from "@/components/shared/Button";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { copyToClipboard } from "@/lib/clipboard";
import { getPublicQuotation, getPublicQuotationPayment } from "@/services/sales/public-quotation.service";
import { Eyebrow, GOLD, GOLD_DEEP, INK, QUOTATION_BODY_FONT, RuledTitle, SHEET_CSS, sheetBackground } from "./PublicQuotationPage";
import { templateContentFor } from "./quotationTemplateContent";

/*
 * Where to pay one quotation, at `/q/<token>/payment`.
 *
 * The quotation prints **For Payment** under its price rather than the account itself - the same
 * way it prints a link to its terms rather than the clauses. Following it opens this: the same
 * sheet, the same mark and name, and the Assigned Branch's bank account, UPI ID and QR set to be
 * read and copied.
 *
 * The details are the branch's as the register holds them *now* - the one thing on the sheet,
 * with the download answer, that is not frozen onto the version. The words and the price were
 * sent and must stay as sent; where the money goes is the studio's standing fact about the branch,
 * and an account changed after the quotation went out has to reach the client still paying it.
 *
 * Only what the branch holds is shown: a branch with no UPI ID prints no UPI section, one with
 * several prints one row each, one without a QR no picture, and a bank account with a blank IFSC
 * prints the rows it has. A branch
 * with nothing to be paid into - or a quotation the register cannot place - is said once, plainly,
 * and the quotation itself is unaffected either way.
 */
export default function PublicQuotationPaymentPage({ token }) {
  const [quotation, setQuotation] = useState(null);
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(null);
  // The payment read failing on its own - a refused request, the register briefly unreachable -
  // is said in place of the cards, under the quotation's own header, rather than as a page that
  // failed: the quotation loaded, and the client should not be told otherwise.
  const [paymentError, setPaymentError] = useState("");
  const branding = useStudioBranding();

  useEffect(() => {
    let active = true;
    Promise.allSettled([getPublicQuotation(token), getPublicQuotationPayment(token)])
      .then(([record, details]) => {
        if (!active) return;
        if (record.status === "rejected") {
          setExpired(expiredLinkFrom(record.reason));
          setError(record.reason?.message || "Unable to load quotation.");
          return;
        }
        setQuotation(record.value.data);
        setError("");
        setExpired(null);
        if (details.status === "fulfilled") {
          setPayment(details.value.data || null);
          setPaymentError("");
        } else if (details.reason?.expired) {
          setExpired(expiredLinkFrom(details.reason));
          setError(details.reason.message || "This link has expired.");
        } else {
          setPayment(null);
          setPaymentError(details.reason?.message || "Unable to load payment details.");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const content = useMemo(() => templateContentFor(quotation, branding), [quotation, branding]);

  // The same three states the quotation settles in, said the same way. A non-expired `error` here
  // is only ever the quotation's own read failing - the payment read failing on its own is said
  // below the header instead - so the heading names the quotation.
  if (loading) return <main className="grid min-h-dvh place-items-center bg-white p-6 text-slate-500">Loading payment details…</main>;
  if (expired) return <ExpiredClientLink {...expired} data-quotation-state="expired" />;
  // Laid out for the phone itself, as the expired card is: in the sheet's 1112px viewport it was
  // drawn at a third of its size. An error is not gone back from, so the viewport stays switched.
  if (error) return <DeviceViewport><main data-quotation-state="error" className="grid min-h-dvh place-items-center bg-white p-6 text-center">
    <div className="w-full max-w-md">
      <AppLogo variant="print" />
      <h1 className="mt-8 text-2xl font-normal" style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: INK }}>Unable to load this quotation</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{error}</p>
    </div>
  </main></DeviceViewport>;

  // NULL on a record older than the list, a list on every one since: both mean the same here.
  const upiIds = Array.isArray(payment?.upiIds) ? payment.upiIds.filter(Boolean) : [];
  /*
   * One card per account, because a branch is commonly paid into more than one - it held exactly one
   * until the register learned to keep a list. The order is the studio's: the first account is the
   * one the branch leads with.
   *
   * Each card prints only what the account actually holds, as a single account always did: a label
   * over a blank tells a client nothing and makes the sheet look unfinished.
   */
  const accounts = (Array.isArray(payment?.accounts) ? payment.accounts : [])
    .map((account) => ({
      bank: String(account.bankNameAndBranch ?? "").trim(),
      rows: [
        ["Account Holder Name", account.accountHolderName, false],
        ["Bank Name & Branch", account.bankNameAndBranch, false],
        ["Account Number", account.accountNumber, true],
        ["IFSC Code", account.ifsc, true],
      ].filter(([, value]) => Boolean(value)),
    }))
    /*
     * Filtered **before** they are numbered. An account with nothing to print is no card, and
     * numbering first left the cards reading "Bank Transfer 1" and "Bank Transfer 3" with nothing
     * between them - a client counting the gap would reasonably wonder what they had not been sent.
     */
    .filter((account) => account.rows.length > 0);

  return <main
    data-quotation-state="ready"
    className="min-h-dvh bg-[#e9e6df] px-0 py-0 sm:px-4 sm:py-8"
    style={{ fontFamily: QUOTATION_BODY_FONT, color: INK }}
  >
    <style>{SHEET_CSS}</style>

    <article className="q-sheet relative mx-auto w-full max-w-[1080px] overflow-hidden shadow-sm" style={{ background: sheetBackground }}>
      <div className="relative px-6 pb-16 pt-14 sm:px-16">
        <header className="text-center">
          <DocumentLogo variant="quotation" src={content.logoUrl} priority className="mx-auto" />
          {Boolean(content.brandName) && <p className="q-display mt-4 text-[20px] font-semibold uppercase tracking-[0.3em] sm:text-[26px]" style={{ color: INK }}>{content.brandName}</p>}
          <RuledTitle className="mt-8" size="text-[30px] sm:text-[38px]">Payment Details</RuledTitle>
          {Boolean(quotation.quotationId) && <p className="q-label mt-3 text-[10px] font-semibold" style={{ color: GOLD_DEEP }}>{quotation.quotationId}</p>}
          <p className="mt-3 text-[13.5px]" style={{ color: "#5c5c5c" }}>Payment details for this quotation</p>
          {Boolean(payment?.branchName) && <p className="q-display mt-5 text-[26px] font-semibold" style={{ color: INK }}>{payment.branchName}</p>}
        </header>

        {payment
          ? <div className="mx-auto mt-10 max-w-2xl space-y-6">
            {/* Said once, above the cards, and only where there is more than one: a client handed
                two accounts and no sentence does not know whether the studio expects one payment or
                two. Plainly, with nothing urgent about it - this is their copy of a quotation. */}
            {accounts.length > 1 && <p className="text-center text-[13px]" style={{ color: "#5c5c5c" }}>
              Pay into any one of these accounts.
            </p>}

            {accounts.map((account, index) => <PaymentCard
              // The account's number is what makes it that account; two cards cannot share one.
              key={account.rows.find(([label]) => label === "Account Number")?.[1] || `account-${index}`}
              /* Numbered only where there is more than one, the way the UPI rows below are - and the
                 bank beside the number, because that is what a client can actually recognise. Two
                 cards differing only in a numeral ask them to compare account numbers to tell which
                 is which. */
              title={accounts.length > 1 ? `Bank Transfer ${index + 1}${account.bank ? ` · ${account.bank}` : ""}` : "Bank Transfer"}
            >
              <dl className="divide-y" style={{ borderColor: "#eee7d9" }}>
                {account.rows.map(([label, value, copyable]) => <PaymentRow
                  key={label}
                  label={label}
                  /* The copy control carries no printed word, so its accessible name is the only
                     thing telling one card's Account Number from another's - and a bank names it
                     better than a numeral for somebody listening rather than looking. */
                  name={accounts.length > 1 ? `${label}, ${account.bank || `account ${index + 1}`}` : label}
                  value={value}
                  copyable={copyable}
                />)}
              </dl>
            </PaymentCard>)}

            {upiIds.length > 0 && <PaymentCard title="UPI Payment">
              {/* Every handle the branch is paid into, in the studio's own order and each with its
                  own copy control - a branch with one reads exactly as it did when a branch could
                  only have one. */}
              <dl className={upiIds.length > 1 ? "divide-y" : ""} style={upiIds.length > 1 ? { borderColor: "#eee7d9" } : undefined}>
                {upiIds.map((upiId, index) => <PaymentRow
                  key={upiId}
                  label="UPI ID"
                  // Numbered only where there is more than one: the copy control carries no
                  // printed word, so its name is the only thing telling two of them apart.
                  name={upiIds.length > 1 ? `UPI ID ${index + 1}` : "UPI ID"}
                  value={upiId}
                  copyable
                />)}
              </dl>
            </PaymentCard>}

            {Boolean(payment.paymentQrUrl) && <PaymentCard title="Payment QR">
              <div className="flex flex-col items-center gap-4 pt-1">
                {/* A plain <img>: the QR is a link into the studio's own bucket - or the picture
                    itself on a machine without one - and neither is a host next/image is configured
                    for. The same reason `AppLogo` draws the mark with one. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={payment.paymentQrUrl} alt={`Payment QR for ${payment.branchName || "this branch"}`} className="h-56 w-56 rounded-2xl bg-white object-contain p-3" style={{ boxShadow: "0 1px 2px rgba(28,28,28,0.06), 0 18px 40px -30px rgba(28,28,28,0.35)" }} loading="eager" />
                <p className="text-[13px]" style={{ color: "#5c5c5c" }}>Scan using any supported UPI application</p>
              </div>
            </PaymentCard>}
          </div>
          : <p className="mx-auto mt-12 max-w-3xl text-center text-[14px]" style={{ color: "#5c5c5c" }}>
            {paymentError
              ? `${paymentError} Please try again in a moment.`
              : "Payment details are not available for this quotation. Please contact your Don't Blink Studioz representative."}
          </p>}

        <p className="mt-14 text-center">
          <a href={`/q/${encodeURIComponent(token)}`} className="text-[13px] font-semibold underline underline-offset-4" style={{ color: "#1a5cd6" }}>Back to the quotation</a>
        </p>
      </div>
    </article>
  </main>;
}

/** One card of the sheet - Bank Transfer, UPI Payment, Payment QR - with its eyebrow. */
function PaymentCard({ title, children }) {
  return <section className="q-card rounded-[24px] px-6 py-7 sm:px-8">
    <Eyebrow color={GOLD} size="text-[12px]" className="tracking-[0.32em]">{title}</Eyebrow>
    <div className="mt-4">{children}</div>
  </section>;
}

/**
 * One value, and a way to copy it where the client will type it somewhere else.
 *
 * Account number, IFSC and UPI ID are copied; the holder's name and the bank's are read.
 *
 * The control is the icon and nothing else - a word beside it named what the row above it already
 * says, twice on a card with two of them. What it is stays readable without being printed: the
 * name is on the button for a screen reader and in the tooltip for a mouse, and `name` numbers it
 * where a card holds several rows of one kind. A copy turns the icon
 * to a tick for a moment and then forgets it, so a second copy answers again rather than sitting
 * there confirming the first - the same rhythm `ShareableMessage` keeps, said without a word.
 */
function PaymentRow({ label, value, copyable = false, name }) {
  const controlName = name || label;
  const [copied, setCopied] = useState(false);

  async function copy() {
    const done = await copyToClipboard(value);
    setCopied(done);
    if (done) window.setTimeout(() => setCopied(false), 2500);
  }

  return <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-3.5">
    <div className="min-w-0">
      <dt className="q-label text-[10px] font-semibold" style={{ color: GOLD_DEEP }}>{label}</dt>
      <dd className={`mt-1 break-all font-semibold ${copyable ? "q-mono text-[15px]" : "text-[15px]"}`} style={{ color: INK }}>{value}</dd>
    </div>
    {copyable && <Button
      type="button"
      variant="plain"
      size="none"
      onClick={() => void copy()}
      // The only name it has, now that nothing is printed beside the icon.
      aria-label={copied ? `${controlName} copied` : `Copy ${controlName}`}
      title={`Copy ${controlName}`}
      className="q-download flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
    >
      {copied ? <CheckRounded style={{ fontSize: 17 }} /> : <ContentCopyRounded style={{ fontSize: 16 }} />}
    </Button>}
  </div>;
}
