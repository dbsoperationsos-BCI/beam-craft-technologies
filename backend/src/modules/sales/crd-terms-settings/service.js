const repository = require("./repository");

/**
 * The wording every public CRD document showed before this table existed — held here, once, as the
 * answer a blank column falls back to. Both verticals shipped with the same text, so both defaults
 * are it; a studio that edits one from the CRD Documents screen leaves the other exactly as it read
 * on day one until it too is edited.
 *
 * Held verbatim as the studio wrote it. This is the wording a client agrees to, so it is not tidied,
 * reworded or re-spelled here — any change to it belongs in the settings screen this module backs,
 * not as a side effect of editing code.
 */
const DEFAULT_TERMS_TEXT = `In the following terms & conditions "The Photographer" shall mean Don't Blink Studioz a part of Beam Craft India Pvt Ltd. "The clients" shall be those persons defined as bride and/or groom on the booking form. These terms & conditions cannot be varied in any way by the clients unless such conditions are expressly agreed by the photographer in writing.

1. COPYRIGHT

The copyright Designs and Patents Acts assign the copyright of the images to the photographer.

2. DISPLAY

The client(s) hereby allow(s) the photographer to display any photograph covered by this contract and to generally promote the business in advertising, brochures, magazine articles, websites, sample albums etc.

3. LICENSE, COVERAGE AND REPRODUCTION:

Photographs taken during the course of the event will be at the discretion of the photographer although every effort will be made to comply with the clients requirements.

The photographer shall be granted artistic license in relation to the poses photographed and the locations used. The photographer's judgement regarding these matters shall be deemed correct.

The photographer shall endeavour to photograph all individuals as requested by the client(s) at some point, but no responsibility will be taken by the photographer on the occasion of leaving somebody out.

For a booking involving a church ceremony or at certain venues, the photographer's movements are sometimes restricted by the official in charge. The area from which the photographer is able to cover the ceremony may not be the photographer's choice and the photographer cannot accept responsibility for any obstructed view should this be the case.

Due to a variety of lighting conditions and the limitations of digital sensors, some colours may alter throughout a set of photographs.

Although all equipment is checked regularly and reasonable steps are taken to ensure backup equipment is available, the photographer will not be responsible for photographs that are not produced due to technical failure.

4. PRICES:

All standard wedding packages and additional goods specified on the booking form are supplied at the prices ruling on the date of booking. Goods not specified on the booking form are supplied at the prices ruling at the time of receipt of the order.

5. PAYMENTS:

A non-refundable booking fee of ---- will confirm your booking, as well as full acceptance of the terms and conditions as published on the photographer's website. The booking fee will be deducted from the cost of the client's chosen package when calculating the final balance due.

Payment in full of the remaining balance will be due on the wedding day.

Additional services requested must be paid for in full at the time of wedding day settlement.

6. FORCE MAJEURE:

The photographer will endeavour to put the client(s) in touch with another photographer in the event they are unable to attend on the wedding date due to any cause beyond their reasonable control e.g. sudden illness, injury, victim of crime, flooding etc.

In the event of cancellation by the photographer, or in the very unlikely event of total photographic failure, liability shall be limited to a full refund of any fees paid.

7. OWNERSHIP:

All digital negatives (computer files) remain the property of the photographer. On occasion, the photographer may supply a copy of the edited digital negatives to the client(s) for their own non-commercial use.

8. Other T&C's

Traditional video song selection is Customer's choice in prior.

Candid video song selection is Editor's choice. Song will not be change if not selected before the event.

Albums will be made only after the photo selection by the client.

Equipment can be added/ removed before 5days at any point of time (Charges will be applied accordingly).

If you've any inspirations regarding your videos or photos, please share before the shoot.

Quote has been raised as per the details received & the same would be considered as final

Charges would be applicable for the extra timing services & the same should be informed at least a month prior to the event.

Hard disc should be provided on/before the wedding event. Else company will not be responsible for any kind of data loss or corruptions.

The validation of the above package cost is 10 days from today.

The ownership of the original photographic negatives and/or recording media will belong to Don't Blink Studioz & will hold the copyright of all taken images/videos & the same would be used for promotional purpose.

If you're concern about your picture privacy in social media, kindly inform us earlier.

Drones and other equipment are subjected to weather conditions.

Delivery of the outputs will take a duration of maximum of 30 days, but this is purely based on the situational conditions. And if there are any delays they will be intimated before time.

Travel, accommodation, and food is as per the package furnished in the quotation.

All Corrections will be taken on queue basis.

Extra offers and complimentary are based on availability & the cost will not be reduced even if you didn't avail that service.

Complementary Post wedding is valid only for 4 months from the date of wedding.

No other services or alternate services will be provided other than that are mentioned in the quotation

Confirmation mail/ Whatsapp message should be sent to proceed further

If incase of any issues from client side, Don't Blink Studioz have all rights to hold back the footages and pause all the works. And the same will be continued once after the issue has been resolved.

All other terms and conditions are according to the customer requirement Document accepted by the client.

Review period of all the works will be 8 months after which all the footages and the last rendered output will be considered as the final and final render will be made and delivered. No other corrections will be carried out after the mentioned time period.

9. Drone Terms & Conditions :-

For Safety Purpose - Drones will not be operated continuously, Only limited & necessary shots would be taken during Reception - 4 hours & Wedding - 4 hours.

Client should get the permission to run the drones in all needed premises.

Any fine imposed over the drone usage will be fully taken care by the client.

For complementary drone included it is purely based upon the availablity.

10. LED Wall Terms & Conditions :-

LED Wall would be used by evening 4 hours & morning 4 hours.

LED Wall would be fixed before Reception, there is no position changes would be done after that.

If you are Out Sourcing the LED Wall & Tv's Client should be taken care of audio arrangements & LED wall problems

Power consumption 20KV needed - This should be provided from client end

If the Client want to display any photos Or videos in LED Walls kindly confirm a month prior or contact the shooting coordinator.

11. Accomadation Terms:-

Accomadation if applicable from client side, we would expect a decent stay and the details should be provided 5days prior to the event.

If the accomadation is provided in the event venue the keys should be handed over to the event coordinator on or before 4 hours form the start of the function.

Failing the above terms it will be considered as No Accomadation and the stay will be booked from the company side. Exact charges will be added to the final bill.

12. Payment Terms

Dates are not held without a confirmation mail and advance

Booking advance - 30% (Non-Refundable)

On the date of function - remaining amount with a hold of 10% rounding off to the nearest.

All payments should be done to 8149549549/ 7904938336/ Current Account (HDFC/ AXIS)/ By Cash to the coordinator and the same should be communicated in the group. Failing the above will be considered as a null payment.

The Photographer reserves the right to amend these Terms and Conditions without prior notice.`;

const MAX_TERMS_LENGTH = 50_000;

function createSettingsService(repo = repository) {
  /** Reading never writes — every public CRD document link goes through this, so creating the row
   *  on read would mean a write on a path that is otherwise read-only, and the default is the same
   *  answer the row would have held anyway. */
  async function read() {
    const stored = await repo.find();
    return {
      dumDumTerms: stored?.dumDumTerms ?? DEFAULT_TERMS_TEXT,
      quaQuaTerms: stored?.quaQuaTerms ?? DEFAULT_TERMS_TEXT,
      updatedAt: stored?.updatedAt ?? null,
    };
  }

  // A field the request leaves out is left as it was — saving Dum Dum's text does not touch Qua
  // Qua's, and neither may reset the other. Whatever comes back is the same fallback-applied shape
  // `read()` returns, so the settings screen never has to know the column is nullable.
  async function save(input, userId) {
    const saved = await repo.upsert({ ...input, updatedByUserId: userId ?? null });
    return {
      dumDumTerms: saved.dumDumTerms ?? DEFAULT_TERMS_TEXT,
      quaQuaTerms: saved.quaQuaTerms ?? DEFAULT_TERMS_TEXT,
      updatedAt: saved.updatedAt ?? null,
    };
  }

  return { read, save };
}

module.exports = { createSettingsService, DEFAULT_TERMS_TEXT, MAX_TERMS_LENGTH };
