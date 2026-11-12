/** Where a finished video can be published, and the shape each place wants. */
export interface Platform {
  id: string;
  name: string;
  width: number;
  height: number;
  /** The page where the user drops the file to publish it. */
  uploadUrl: string;
  /** What kind of caption suits it, for the caption writer. */
  captionHint: string;
}

export const PLATFORMS: Platform[] = [
  {
    id: "tiktok",
    name: "TikTok",
    width: 1080,
    height: 1920,
    uploadUrl: "https://www.tiktok.com/upload",
    captionHint: "a short, catchy TikTok caption under 120 characters",
  },
  {
    id: "reels",
    name: "Instagram Reels",
    width: 1080,
    height: 1920,
    uploadUrl: "https://www.instagram.com/",
    captionHint: "a warm Instagram Reels caption of one or two sentences",
  },
  {
    id: "shorts",
    name: "YouTube Shorts",
    width: 1080,
    height: 1920,
    uploadUrl: "https://www.youtube.com/upload",
    captionHint: "a YouTube Shorts title under 90 characters",
  },
  {
    id: "youtube",
    name: "YouTube",
    width: 1920,
    height: 1080,
    uploadUrl: "https://www.youtube.com/upload",
    captionHint: "a clear YouTube title, then a two-sentence description on the next line",
  },
  {
    id: "x",
    name: "X",
    width: 1280,
    height: 720,
    uploadUrl: "https://x.com/compose/post",
    captionHint: "a post for X under 200 characters",
  },
];

export function getPlatform(id: unknown): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}
