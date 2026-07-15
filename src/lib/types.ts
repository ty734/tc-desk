// Shared shapes passed from server components to client components.

export type Member = { id: string; name: string; email: string; role: string };

export type FieldOptionData = { id: string; label: string; color: string };

export type FieldData = {
  id: string;
  name: string;
  type: string;
  options: FieldOptionData[];
};

// Customer-visible message in the ticket thread (email, or a social
// comment/DM on the Meta channels).
export type MessageData = {
  id: string;
  direction: string; // inbound | outbound
  fromAddr: string;
  toAddr: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: string;
  author: { id: string; name: string } | null;
  attachments: { id: string; filename: string; contentType: string; blobUrl: string; sizeBytes: number | null }[];
  // Social (Meta) fields — absent/null on email and chat messages.
  platformMessageId?: string | null;
  platformThreadId?: string | null;
  windowExpiresAt?: string | null; // DMs: end of the 24h reply window
  aiDraft?: string | null; // AI-suggested reply awaiting human approval
  aiConfidence?: number | null;
  aiIntent?: string | null;
  aiFlagReason?: string | null;
};

// INTERNAL note — never emailed to the customer.
export type CommentData = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
};

export type TicketData = {
  id: string;
  number: number | null;
  columnId: string;
  subject: string;
  position: number;
  channel: string; // email | amazon | chat | facebook_comment | facebook_dm | instagram_comment | instagram_dm
  status: string; // new | open | pending | solved | closed
  customerName: string | null;
  customerEmail: string | null;
  assigneeId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  fieldValues: { fieldId: string; optionId: string | null }[];
};

export type ColumnData = {
  id: string;
  name: string;
  position: number;
  tickets: TicketData[];
};

export type BoardData = {
  id: string;
  name: string;
  members: Member[];
  fields: FieldData[];
  columns: ColumnData[];
};
