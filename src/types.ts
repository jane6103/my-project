export interface Clipping {
  id: string;
  bookTitle: string;
  author: string;
  location: string;
  dateAdded: string;
  content: string;
  comment: string;
  rawDate: string;
  timestamp: number; // For sorting
}

export interface BookSummary {
  title: string;
  author: string;
  count: number;
}
