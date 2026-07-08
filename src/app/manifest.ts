import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Living Well Desk",
    short_name: "LW Desk",
    description: "Living Well customer support desk",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8f6",
    theme_color: "#6E9277",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
