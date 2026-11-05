import Link from "next/link";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import MarketingLogo from "./MarketingLogo";
import { CONTACT, CONTACT_HREF, SIGN_IN_HREF } from "./homeContent";

const iconSx = { fontSize: 16, color: "hsl(var(--mk-primary))" };

export default function MarketingFooter() {
  return (
    <footer className="border-t border-mk-border bg-mk-secondary/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-5 md:grid-cols-[1.5fr_1fr_1fr_1.2fr]">
        <div>
          <MarketingLogo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-mk-muted-foreground">Crafting Intelligence into Software. Customized next-gen applications for executive teams.</p>
          <div className="mt-5 flex flex-col gap-2 text-sm text-mk-muted-foreground">
            <a href={`mailto:${CONTACT.email}`} className="flex items-center gap-2 transition-colors hover:text-mk-foreground"><MailOutlineRoundedIcon sx={iconSx} /> {CONTACT.email}</a>
            <a href={CONTACT.phoneHref} className="flex items-center gap-2 transition-colors hover:text-mk-foreground"><PhoneRoundedIcon sx={iconSx} /> {CONTACT.phone}</a>
            <span className="flex items-center gap-2"><PublicRoundedIcon sx={iconSx} /> {CONTACT.website}</span>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Product</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-mk-muted-foreground">
            <li><a href="#features" className="transition-colors hover:text-mk-foreground">Features</a></li>
            <li><a href="#how" className="transition-colors hover:text-mk-foreground">How it works</a></li>
            <li><a href="#pricing" className="transition-colors hover:text-mk-foreground">Pricing</a></li>
            <li><Link href={SIGN_IN_HREF} className="transition-colors hover:text-mk-foreground">Sign in</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Company</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-mk-muted-foreground">
            <li><a href={CONTACT_HREF} className="transition-colors hover:text-mk-foreground">Book a demo</a></li>
            <li><a href={CONTACT_HREF} className="transition-colors hover:text-mk-foreground">Request a quote</a></li>
            <li><a href={`mailto:${CONTACT.email}`} className="transition-colors hover:text-mk-foreground">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Registered office</h4>
          <address className="mt-4 flex items-start gap-2 text-sm not-italic leading-relaxed text-mk-muted-foreground">
            <PlaceRoundedIcon sx={{ ...iconSx, mt: "2px" }} />
            <span>BEAM CRAFT INDIA PRIVATE LIMITED<br />077/1, Thendral Nagar, Manikkampalayam,<br />Veerappanchatram, Erode-638004,<br />Tamilnadu, India</span>
          </address>
        </div>
      </div>
      <div className="border-t border-mk-border px-4 py-5 text-center text-xs text-mk-muted-foreground">© {new Date().getFullYear()} BeamCraft India Pvt. Ltd. All rights reserved.</div>
    </footer>
  );
}
