import type { MetadataRoute } from "next";

/** Lets CareNest be added to a phone's home screen; on iPhone that's required for phone alerts. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CareNest",
    short_name: "CareNest",
    description: "Coordinate care for aging parents with your family.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f6f4ef",
    theme_color: "#0e6457",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
