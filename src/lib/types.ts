// Shared shapes passed from server components to client components.

export type Member = { id: string; name: string; email: string; role: string };

export type FieldOptionData = { id: string; label: string; color: string };

export type FieldData = {
  id: string;
  name: string;
  type: string;
  options: FieldOptionData[];
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
  columnId: string;
  subject: string;
  position: number;
  channel: string; // email | amazon | chat | ig | fb
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
