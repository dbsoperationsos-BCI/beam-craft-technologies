/** Details-screen help for project fields - see `index.js`. */

/*
 * Texts that more than one key or section shares are written once here, so two screens showing the
 * same fact cannot explain it two different ways.
 */
const VERTICAL = "The brand the project is sold under: DD (Dum Dum, weddings), QQ (Qua Qua, baby and family shoots) or Corp.";
const CLIENT_NAME = "The client's name as the project knows it, from the sale and its enquiry.";
const PROJECT_STATUS = "Where the whole project stands: Yet to Start until Start Project is saved, then In Progress, and later On Hold, Rejected or Completed.";
const CRD_STATUS = "Whether the client is to fill in a CRD (client requirement document) for this project, answered on Start Project.";
const STORAGE_ID = "The Client Storage record (SM ID) for this project's hard disk, raised automatically when the project needs storage.";
const RECEIVED_STORAGE = "Yes once Client Storage has moved the hard disk past Yet to Receive, meaning the studio has it.";
const STORAGE_STATUS = "Where the hard disk stands in Client Storage, such as Yet to Receive or Yet to Start. Client Storage moves it on.";
const SALES_PRE_PRODUCTION_REMARKS = "Notes from Sales for the Pre Production team, written on the booking or on Start Project.";
const PRE_PRODUCTION_COORDINATOR = "The employee who plans the shoots with the client, named on Start Project.";
const CREATIVE_MANAGER = "The employee who leads the creative side of this project, named on Start Project.";
const POST_PRODUCTION_COORDINATOR = "The employee who sees editing and deliverables through to delivery, named on Start Project.";
const PROJECT_MANAGER = "The employee who owns this project from start to delivery, named on Start Project.";
const PRODUCTION_MANAGER = "The employee who runs the shoot days and the crew, named on Start Project.";

/*
 * Feedback - one section per feedback stage, its fields keyed `<STAGE>.<field>` on the record
 * (`lib/feedbackRecord.mjs`), so the help is keyed the same way. A Shoot Completion Feedback's keys
 * carry the shoot's own id as well (`SHOOT_COMPLETION.<shoot>.<field>`); `detailHelpFor` drops that id
 * before looking, so they are written here as `SHOOT_COMPLETION.<field>`.
 */
const FEEDBACK_GIVEN = {
  feedbackCode: "This feedback's ID: the project's Feedback ID (DBS-FB-…) and its version, given when it is saved.",
  status: "Yet to be done until it is given. Excellent or Good files it Completed; Average or Poor files it under Issues.",
  review: "How the client rated the work: Excellent, Good, Average or Poor. Average or Poor becomes a task for someone to sort out.",
  feedback: "The client's comments in their own words, typed in by whoever took the feedback.",
  givenBy: "The person who recorded this feedback in the app.",
  createdAt: "The day this feedback was recorded.",
  issueRemarks: "The remark given when this feedback was moved from Issues to Issues sorted or Rejected.",
  issueResolvedBy: "Who moved this feedback from Issues to Issues sorted or Rejected.",
  issueResolvedAt: "The day this feedback was moved from Issues to Issues sorted or Rejected.",
  salesReview: "The client's rating of the Sales team: Excellent, Good, Average or Poor.",
  salesFeedback: "What the client said about the Sales team, in their own words.",
  preProductionReview: "The client's rating of the Pre Production team: Excellent, Good, Average or Poor.",
  preProductionFeedback: "What the client said about the Pre Production team, in their own words.",
  productionReview: "The client's rating of the Production (shoot) team: Excellent, Good, Average or Poor.",
  productionFeedback: "What the client said about the Production (shoot) team, in their own words.",
  referralName: "Someone the client referred to the studio while giving this feedback.",
  referralMobile: "The mobile number of the person the client referred.",
  appreciated: "The people who worked on the project that the client appreciated by name.",
  notSatisfied: "The people who worked on the project that the client was not satisfied with.",
  postProductionReview: "The client's rating of the editing and deliverables: Excellent, Good, Average or Poor.",
  postProductionFeedback: "What the client said about the editing and deliverables, in their own words.",
  overallExperience: "The client's rating of their whole experience with the studio.",
  suggestion: "Anything the client suggested the studio could do better.",
};
const FEEDBACK_ISSUE = {
  assignedTo: "The person an Average or Poor review was given to as a task, to sort the issue out.",
  taskStatus: "Where that person's task stands in Tasks, from Pending through to Completed.",
  taskCode: "The ID of the task raised for this issue; search it in Tasks to open it.",
  status: "How the issue ended: Open while being worked on, then Issues sorted or Rejected.",
  remarks: "What the person given the issue wrote when they answered it.",
};
/** The shoot a Shoot Completion Feedback is about, first in its section. */
const FEEDBACK_SHOOT = {
  shootCode: "The Shoot ID (DBS-SID-…) of the shoot this feedback is about, given when the shoot was added to the project.",
  shootName: "The name of the shoot this feedback is about, as it was entered when the shoot was planned.",
  shootDate: "The day this shoot took place, read from the shoot record.",
};
const FEEDBACK_STAGES = ["NEW_PROJECT", "SHOOT_COMPLETION", "OVERALL", "PRODUCTION_COMPLETION", "PROJECT_COMPLETED"];
const feedbackHelp = Object.fromEntries(FEEDBACK_STAGES.flatMap((stage) => [
  ...(stage === "SHOOT_COMPLETION" ? Object.entries(FEEDBACK_SHOOT).map(([key, text]) => [`${stage}.${key}`, text]) : []),
  ...Object.entries(FEEDBACK_GIVEN).map(([key, text]) => [`${stage}.${key}`, text]),
  // Up to five assigned issues per feedback - one per area reviewed - each keyed by its place in the list.
  ...[0, 1, 2, 3, 4].flatMap((index) => Object.entries(FEEDBACK_ISSUE).map(([key, text]) => [`${stage}.issue${index}.${key}`, text])),
]));

const HELP = {
  // Project Identity / Client & Branch / Event Planning / Deliverables (every project panel)
  eventId: "The project's own ID, given when the sale is booked (DBS-BK-vertical-branch-number). Quote it to find the project anywhere.",
  enquiryId: "The enquiry (CRM lead) this project was booked against. It links the project back to its lead and quotations.",
  projectStatus: PROJECT_STATUS,
  whatsappGroupName: "The project's name as the studio says it, made by the WhatsApp group name generator when the sale was booked.",
  "Project Identity.vertical": VERTICAL,
  clientMainNumber: "The client's main mobile number from the booking, used for WhatsApp messages and the client's login.",
  sourceBranch: "The branch that brought in this booking, set on the sale (from the quotation when one was chosen).",
  crmName: "The CRM (salesperson) who booked this project, filled in from whoever saved the sale.",
  mainEventDateKnown: "Yes once the main event's day is fixed, read from the shoot marked as the main event.",
  mainEventDate: "The day of the main event, taken from the shoot marked as the main event. Blank while it is not fixed.",
  initialConvertedValue: "The amount the sale was signed for (the Signed Quotation) when it was booked, before any extras.",
  deliverables: "As per Quote when the client gets what the quotation lists; Others when something different was agreed.",
  deliverablesDetails: "What was agreed instead of the quotation's deliverables, written by Sales when Deliverables is Others.",

  // WhatsApp Group Details - what the group name generator in Sales was given
  "WhatsApp Group Details.vertical": "The vertical the group name was generated for. It sets the name's prefix: WED for Dum Dum, QQ for Qua Qua, CORP for Corp.",
  waBranch: "The branch chosen in the group name generator; its short code (such as ERD or CBE) is written into the name.",
  waOfferName: "The offer the client booked under, if any, as typed into the group name generator.",
  waClientName: "The client's name as typed into the group name generator. A Dum Dum name uses the groom and bride instead.",
  waPlace: "The town or venue of the event, typed into the group name generator and added to the name.",
  waGou: "Qua Qua only: Yes when the booking is marked GOU, which adds GOU to the group name.",
  waHouseType: "Qua Qua only: IH (in-house) or OH (outdoor), as booked. It is written into the group name.",
  waSocialMediaPosting: "SM if the client allows their photos on social media, NSM if not. Written into the group name.",
  waGeneratorCreatedAt: "When this group name was generated in Sales.",
  waGeneratorExpiresAt: "A generated name is held for 10 days. An unused one expires after this date and cannot be booked against.",
  waGeneratorUsedStatus: "Used once a project was booked with this name; otherwise Available, or Expired after 10 days unused.",

  // Remarks
  salesPreProductionRemarks: SALES_PRE_PRODUCTION_REMARKS,
  salesProductionRemarks: "Notes from Sales for the Production (shoot) team, written on the booking or on Start Project.",
  salesPostProductionRemarks: "Notes from Sales for the Post Production (editing) team, written on the booking or on Start Project.",

  // Project Workflow / Project Identification (Projects)
  "Project Workflow.projectStatus": PROJECT_STATUS,
  startProjectStatus: "Whether Start Project has been saved. Starting names the team and moves the project to In Progress.",
  projectManager: PROJECT_MANAGER,
  preProductionCoordinator: PRE_PRODUCTION_COORDINATOR,
  creativeManager: CREATIVE_MANAGER,
  postProductionCoordinator: POST_PRODUCTION_COORDINATOR,
  productionManager: PRODUCTION_MANAGER,
  welcomeGift: "Applicable when the client gets a welcome gift with this booking, set on Start Project. Tracked in Client Gifts.",
  welcomeGiftAssignee: "The employee who arranges and hands over the welcome gift.",
  shootCompletedGift: "Applicable when the client gets a gift once the shoots are done, set on Start Project. Tracked in Client Gifts.",
  shootCompletedGiftAssignee: "The employee who arranges and hands over the shoot completed gift.",
  projectValidityMonths: "How many months the project stays valid, in whole months, set on Start Project.",
  storageNeeded: "Yes when the project includes storing the client's files on a hard disk, which Client Storage then tracks.",
  crdDocumentStatus: CRD_STATUS,

  // Workflow sections - the project's shoots, read three ways
  "Shoot Creation.shoots": "Every shoot added to the project: its Shoot ID, date, name, place and session timing.",
  "Production Creation.shoots": "The services allocated to each shoot, set on Start Project, with any details given.",
  "Post Production Allocation.shoots": "The deliverables planned for each shoot and how many of each, set on Start Project.",

  // Production Assignment (Production table)
  productionTravelMode: "How the crew travels to the shoot, from the shoot's production plan.",
  productionDrivenBy: "Who drives the crew to the shoot, from the production plan.",
  productionVehicle: "The vehicle used to reach the shoot: Owned, Rental or Office Vehicle.",
  productionCoordinator: "The project coordinator who made this production assignment.",
  productionAssignedPerson: "The employee assigned to this production, with their employee ID.",
  productionEquipment: "The equipment assigned for this production, with its asset code.",
  productionRemarks: "Notes on this production assignment from whoever made it.",

  // Pre Production - one shoot ("Project", "People", "Shoot", …)
  "Project.clientName": CLIENT_NAME,
  "Project.product": VERTICAL,
  "Project.crdDocumentStatus": CRD_STATUS,
  crdDocumentState: "How far the client's CRD document has got: Not Issued until a link is sent, then Sent, and Submitted once the client sends it back.",
  crdSidesReceived: "For a wedding, which side's CRD answers are complete: groom, bride, both or neither. Blank for Qua Qua.",
  crdCompletion: "How much of the CRD document the client has filled in so far, as a percentage.",
  crdSubmittedAt: "When the client submitted the CRD document. Blank until they do.",
  "People.crmName": "The CRM (salesperson) who booked this project.",
  "Shoot.shootId": "The shoot's own ID (DBS-SID-…), given when the shoot is added. Each shoot of a project has its own.",
  "Shoot.shoot": "The kind of shoot, such as Haldi or Wedding, picked from the studio's list when the shoot was added.",
  shootType: "Studio / In-House when the shoot is at the studio; Outdoor / On-Location when the crew travels to a venue.",
  subEventDate: "The day this shoot happens, set when it is added and changeable on the Pre Production form.",
  isMainEvent: "Yes when this shoot is the project's main event. Its date becomes the project's Main Event Date.",
  shootPlace: "The venue or area where the shoot happens, given when the shoot was added.",
  "Shoot.district": "The district the shoot place is in.",
  "Shoot.state": "The state the shoot place is in.",
  sessionTiming: "How the shoot is booked: Hourly, Half Session or Full Session. It decides how long the crew is booked.",
  locationAddress: "The venue's full address, filled in by the Pre Production coordinator.",
  locationLink: "A map link to the venue, so the crew can find it.",
  eventStartTime: "When the event itself begins, filled in by Pre Production.",
  eventEndTime: "When the event ends. A time earlier than the start means it ends the next day.",
  reportingTime: "When the crew must reach the venue, usually before the event starts.",
  scheduleRemarks: "Pre Production's notes about the schedule or the journey.",
  conceptList: "The concepts agreed with the client for this shoot, each with its reference link and remarks.",
  travelAccommodationNeeded: "Yes when the crew's travel and stay must be arranged for this shoot.",
  travelPaidBy: "Who pays for the crew's travel, Studio or Client, as agreed when the shoot was added.",
  accommodationPaidBy: "Who pays for the crew's stay, Studio or Client, as agreed when the shoot was added.",
  foodTakenCareBy: "Who provides the crew's food on the shoot day, Studio or Client.",
  accommodationAddress: "The full address where the crew will stay.",
  accommodationLink: "A map or booking link for the crew's stay.",
  accommodationRemarks: "Pre Production's notes about the stay, such as check-in times.",
  completionStatus: "The shoot's Pre Production status: Yet to Start, Work in Progress, or Planned once every detail is filled. WCR, Hold or Rejected are set by hand.",
  shootStatusRemarks: "Why the shoot was set to WCR (waiting for the client's reply), Hold or Rejected.",
  storageId: STORAGE_ID,
  receivedTheStorage: RECEIVED_STORAGE,
  storageStatus: STORAGE_STATUS,

  // Dum Dum / Qua Qua checklists
  groomAddress: "The groom's full address, as the family gave it to Pre Production.",
  brideAddress: "The bride's full address, as the family gave it to Pre Production.",
  introCallGroom: "Yes once the introduction call with the groom's side is done.",
  introCallBride: "Yes once the introduction call with the bride's side is done.",
  introCall: "Yes once the introduction call with the client is done.",
  introCallRemarks: "Anything learned on the intro call that the team should know.",
  eventScheduleMeeting: "Yes when a meeting with the client to go through the event schedule is set.",
  meetingDate: "The day of the event schedule meeting with the client.",
  meetingTime: "The time the event schedule meeting starts.",
  meetingLink: "The online meeting link, when the schedule meeting is held online.",
  invitationSoftCopy: "Yes when the invitation's soft copy is being collected from the client.",
  invitationLink: "A link to the invitation's soft copy.",
  gettingDressesImages: "Whether photos of the outfits have been collected from the client.",
  gettingDecorImages: "Whether photos of the decor have been collected.",
  siteVisit: "Whether the team has visited the venue before the shoot.",
  postWeddingGift: "Whether the post-wedding gift has been taken care of.",

  // Pre Production - one project (its shoots summarised)
  shootCount: "How many shoots the project has.",
  shootNames: "The names of the project's shoots.",
  shootIds: "The Shoot IDs of the project's shoots.",
  subEventDates: "The dates of the project's shoots, in the same order as the shoot names.",
  completionStatusLabel: "The project's Pre Production status, worked out from its shoots: Yet to Start, Work in Progress (with %), Planned, or Hold or Rejected set by hand.",
  preProductionStatusRemarks: "Why the project's Pre Production was set to Hold or Rejected by hand, with who set it and when.",
  completionSummary: "How many of the project's shoots are Planned, out of all its shoots.",
  shootsPending: "The shoots that still have details to fill before they are Planned.",
  lastFollowupDate: "The last day a follow-up with the client was marked done.",
  nextFollowupDate: "The next follow-up with the client still to be done. Shown on the Follow-up tab once due.",
  followupRemarks: "The note on the next follow-up, or on the last one done.",

  // Client Gifts
  giftLabel: "Which gift this is: the Welcome Gift, sent when the client books, or the Shoot Completed Gift, sent after the shoots.",
  "Gift.status": "Where the gift has got to: Yet To Sent, Sent, or Received by Client.",
  "Gift.assignee": "The employee taking care of this gift, named on Start Project.",
  "Gift.sentAt": "The day the gift was marked Sent.",
  "Gift.receivedAt": "The day the gift was marked Received by Client.",
  "Project.vertical": VERTICAL,

  // Feedback - the project it is for
  eventDate: "The project's main event date.",
  projectName: "The project's name: its WhatsApp group name.",
  "Project.branch": "The branch the project belongs to.",
  ...feedbackHelp,
};

export default HELP;
