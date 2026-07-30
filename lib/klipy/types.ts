export type KlipyMediaAttachment = {
  alt: string;
  aspect: number;
  description: string;
  displayUrl: string;
  height: number;
  itemUrl: string;
  kind: "gif";
  previewUrl: string;
  provider: "klipy";
  providerMediaId: string;
  title: string;
  width: number;
};

export type KlipyResolvedMediaAttachment = KlipyMediaAttachment & {
  contentFingerprint: string;
};

export type KlipySearchPage = {
  items: KlipyMediaAttachment[];
  nextCursor: string | null;
  provider: "klipy";
};

export type KlipyReplyMediaPreview = {
  alt: string;
  kind: "gif";
  previewUrl: string;
};
