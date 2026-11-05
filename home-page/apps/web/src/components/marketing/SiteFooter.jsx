import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Globe, Phone, MapPin } from 'lucide-react';
import Logo from '@/components/Logo';

export default function SiteFooter() {
    return (
        <footer className="border-t border-border bg-secondary/40">
            <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.5fr_1fr_1fr_1.2fr]">
                <div>
                    <Logo />
                    <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
                        Crafting Intelligence into Software. Customized next-gen applications for executive teams.
                    </p>
                    <div className="mt-5 flex flex-col gap-2 text-sm text-muted-foreground">
                        <a href="mailto:hello@beamcraft.tech" className="flex items-center gap-2 transition-colors hover:text-foreground">
                            <Mail className="h-4 w-4 text-beam" /> hello@beamcraft.tech
                        </a>
                        <a href="tel:+918149549549" className="flex items-center gap-2 transition-colors hover:text-foreground">
                            <Phone className="h-4 w-4 text-beam" /> +91 8149549549
                        </a>
                        <span className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-beam" /> beamcraft.tech
                        </span>
                    </div>
                </div>
                <div>
                    <h4 className="text-sm font-semibold">Product</h4>
                    <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                        <li><a href="/#features" className="transition-colors hover:text-foreground">Features</a></li>
                        <li><a href="/#how" className="transition-colors hover:text-foreground">How it works</a></li>
                        <li><a href="/#pricing" className="transition-colors hover:text-foreground">Pricing</a></li>
                        <li><Link to="/signup" className="transition-colors hover:text-foreground">Free trial</Link></li>
                    </ul>
                </div>
                <div>
                    <h4 className="text-sm font-semibold">Company</h4>
                    <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                        <li><Link to="/demo" className="transition-colors hover:text-foreground">Book a demo</Link></li>
                        <li><Link to="/quote" className="transition-colors hover:text-foreground">Request a quote</Link></li>
                        <li><a href="mailto:hello@beamcraft.tech" className="transition-colors hover:text-foreground">Contact</a></li>
                    </ul>
                </div>
                <div>
                    <h4 className="text-sm font-semibold">Registered office</h4>
                    <address className="mt-4 flex items-start gap-2 text-sm not-italic leading-relaxed text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-beam" />
                        <span>
                            BEAM CRAFT INDIA PRIVATE LIMITED<br />
                            077/1, Thendral Nagar, Manikkampalayam,<br />
                            Veerappanchatram, Erode-638004,<br />
                            Tamilnadu, India
                        </span>
                    </address>
                </div>
            </div>
            <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
                © {new Date().getFullYear()} BeamCraft India Pvt. Ltd. All rights reserved.
            </div>
        </footer>
    );
}
