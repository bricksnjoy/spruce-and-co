import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Photos of bills and salary slips are sent through server actions. The
      // default 1MB turns away an ordinary phone photo; Vercel itself refuses
      // request bodies over 4.5MB, so this stays just under that.
      bodySizeLimit: "4mb",
    },
  },
  // The old accounting screens, retired once the rebuilt books took their
  // place: bookmarks and old links land on the screen that does the job now.
  async redirects() {
    const to = (source: string, destination: string) => ({ source, destination, permanent: false });
    return [
      to("/invoices/:path*", "/sales"),
      to("/print/invoices/:path*", "/sales"),
      to("/capital-pool/:path*", "/partners"),
      to("/investors/:path*", "/partners"),
      to("/financing/:path*", "/partners"),
      to("/internal/:path*", "/partners"),
      to("/profit-share/:path*", "/settings/profit-share"),
      to("/pnl/:path*", "/reports"),
      to("/gst/:path*", "/taxes"),
      to("/accounting", "/"),
      to("/accounting/ledger/:path*", "/reports/general-ledger"),
      to("/accounting/audit/:path*", "/accounting/health"),
      to("/accounting/statements/:path*", "/reports"),
      to("/print/statements/:path*", "/reports"),
      to("/accounting/bank/:path*", "/banking"),
      to("/accounting/tax/:path*", "/taxes"),
      to("/accounting/year-end/:path*", "/reports"),
      to("/projects/:id/legacy", "/projects/:id"),
    ];
  },
};

export default nextConfig;
