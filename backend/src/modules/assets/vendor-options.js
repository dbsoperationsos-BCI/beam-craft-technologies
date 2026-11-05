const { optionNames } = require("../../services/optionLists");

/*
 * What a vendor is engaged for.
 *
 * This array was the whole list, served to the form and validated against, so a studio that started
 * hiring a trade it had not hired before had no way to say so. It is a list the studio maintains now
 * (Settings → Fields → Vendors) and this is what a failed or empty read falls back to - which is
 * exactly what the form offered before.
 */
const FALLBACK_VENDOR_TYPES = ["Photographer", "Editor", "Makeup Artist", "Printing", "Rental", "Videographer", "Drone Operator", "Album Designer", "Lighting", "Sound", "Live Streaming", "Anchor", "Event Management", "Other"];
const vendorTypes = () => optionNames("vendorType", FALLBACK_VENDOR_TYPES);

const skillGroups = {
  Photography: ["Wedding Photography", "Candid Photography", "Traditional Photography", "Bridal Portraits", "Groom Portraits", "Couple Portraits", "Family Portraits", "Group Photography", "Reception Photography", "Engagement Photography", "Mehendi Photography", "Haldi Photography", "Sangeet Photography", "Temple Wedding Photography", "Church Wedding Photography", "Muslim Wedding Photography", "Destination Wedding Photography", "Elopement Photography", "Pre-Wedding Photography", "Post-Wedding Photography", "Baby Shower Photography", "Maternity Photography", "Newborn Photography", "Kids Photography", "Birthday Photography", "Corporate Photography", "Product Photography", "Food Photography", "Architecture Photography", "Interior Photography", "Fashion Photography", "Lifestyle Photography", "Jewelry Photography", "Industrial Photography", "School Photography", "Event Photography", "Sports Photography", "Drone Photography", "Real Estate Photography"],
  Videography: ["Wedding Cinematography", "Traditional Videography", "Documentary Style", "Highlight Films", "Same Day Edit (SDE)", "Trailer Editing", "Teaser Production", "Reel Production", "Corporate Films", "Product Videos", "Drone Videography", "Live Streaming", "Interview Recording", "Podcast Recording", "Multi Camera Production", "Gimbal Operation", "Steadicam Operation"],
  Drone: ["Drone Pilot", "FPV Drone", "Cinematic Drone", "Drone Mapping", "Drone Safety", "DGCA Certified Pilot"],
  Editing: ["Photo Editing", "Lightroom Basic Editing", "Lightroom Advanced Editing", "Lightroom Color Matching", "Lightroom Batch Editing", "Lightroom Presets", "Exposure Correction", "White Balance", "Color Correction", "Color Grading", "Skin Tone Correction", "Face Cleanup", "Blemish Removal", "Teeth Whitening", "Eye Enhancement", "Background Cleanup", "Object Removal", "Sky Replacement", "HDR Processing", "Noise Reduction", "Sharpening", "High-End Retouching", "Beauty Retouching", "Frequency Separation", "Dodge & Burn", "AI Retouching"],
  Photoshop: ["Compositing", "Manipulation", "Album Designing", "Background Replacement", "Hair Retouch", "Liquify", "Color Matching", "AI Generative Fill", "AI Expand", "Masking", "Clipping Path", "Restoration", "Product Retouching"],
  "AI Skills": ["AI Photo Culling", "AI Face Selection", "AI Duplicate Removal", "AI Color Correction", "AI Noise Removal", "AI Upscaling", "AI Background Removal", "AI Object Removal", "AI Skin Retouch", "AI Album Design", "AI Caption Generation", "AI Storytelling", "AI Video Highlights", "AI Trailer Generation", "AI Face Recognition", "AI Smile Detection", "AI Blink Detection", "AI Emotion Detection", "AI Photo Tagging", "AI Auto Keywording", "AI Search", "AI Voice Enhancement", "AI Subtitle Generation", "AI Translation", "AI Image Generation", "AI Video Generation"],
  "Photo Culling": ["Narrative Select", "AfterShoot", "FilterPixel", "Imagen Culling", "Manual Culling", "Duplicate Removal", "Blink Detection", "Blur Detection", "Face Rating", "Emotion Rating"],
  "Video Editing": ["Premiere Pro", "DaVinci Resolve", "Final Cut Pro", "CapCut", "Filmora", "Vegas Pro", "After Effects", "Motion Graphics", "Color Grading", "Audio Sync", "Multicam Editing", "Proxy Workflow", "LUT Management"],
  "Motion Graphics": ["After Effects", "Titles", "Intro Animation", "Logo Animation", "Lower Thirds", "Wedding Invitation Video", "Save The Date Video", "LED Wall Animation", "Screen Graphics"],
  "Album Designing": ["Wedding Album", "Baby Album", "Premium Album", "Flush Mount Album", "Coffee Table Album", "Magazine Album", "Storybook Album", "Parent Album", "Canva Album", "Smart Album", "AI Album Design"],
  Printing: ["Album Printing", "Canvas Printing", "Fine Art Printing", "Acrylic Printing", "Photo Frames", "HD Printing", "Metal Prints", "UV Printing", "Lamination", "Quality Inspection"],
  "LED Wall": ["LED Wall Content Design", "Wedding LED Programming", "LED Wall Operation", "Screen Mapping", "Live Feed Switching", "Resolume", "NovaStar", "Video Wall Calibration", "Stage Display", "Countdown Animation"],
  Audio: ["Audio Recording", "Voice Over", "Audio Cleanup", "Audio Mixing", "Mastering", "DJ Coordination", "Sound System Setup"],
  Lighting: ["Flash Photography", "Continuous Lighting", "Studio Lighting", "Softbox", "Godox Systems", "Profoto Systems", "Aputure Lighting", "LED Panels", "RGB Lighting", "Outdoor Lighting"],
  "Camera Systems": ["Canon", "Sony", "Nikon", "Fujifilm", "Panasonic", "RED", "Blackmagic", "DJI", "GoPro", "Insta360"],
  "Equipment Handling": ["Camera Maintenance", "Lens Calibration", "Sensor Cleaning", "Battery Management", "Memory Card Management", "Data Backup", "NAS Storage", "RAID Storage"],
  "Software Skills": ["Adobe", "Lightroom Classic", "Photoshop", "Premiere Pro", "After Effects", "Illustrator", "InDesign", "Acrobat", "Apple", "Final Cut Pro", "Motion", "Compressor", "Blackmagic", "DaVinci Resolve", "Fusion", "AfterShoot", "Narrative Select", "Imagen AI", "FilterPixel", "Evoto AI", "Topaz Photo AI", "Topaz Video AI", "Adobe Firefly", "Midjourney", "ChatGPT", "Runway ML", "Kling AI", "Pika", "Luma AI", "Fundy Designer", "SmartAlbums", "Album Express", "Resolume Arena", "NovaLCT", "SmartLCT", "XPression"],
  "Data Management": ["Photo Backup", "Cloud Upload", "NAS Management", "RAID Configuration", "SSD Management", "Memory Card Recovery", "File Naming", "Folder Organization", "Metadata Management", "Archive Management"],
  "Production Management": ["Shoot Planning", "Timeline Creation", "Team Coordination", "Vendor Coordination", "Client Communication", "Budget Management", "Logistics", "Equipment Planning", "Risk Assessment", "Travel Planning"],
  "Customer Experience": ["Client Handling", "Posing Guidance", "Baby Handling", "Crowd Management", "VIP Management", "Hospitality", "Complaint Resolution"],
  "Makeup & Styling": ["Bridal Makeup", "Groom Makeup", "Baby Styling", "Hair Styling", "Saree Draping", "Costume Coordination", "Jewellery Styling"],
  "Digital Marketing": ["Instagram Reels", "Facebook Ads", "Google Ads", "SEO", "YouTube", "Content Writing", "Blogging", "Thumbnail Design", "Social Media Management"],
  "Quality Control (QC)": ["Photo QC", "Video QC", "Album QC", "Print QC", "Color Consistency", "Sharpness Check", "Delivery QC", "AI-assisted QC"],
  "Emerging Technologies": ["360° Photography", "360° Video", "VR Content", "AR Experiences", "Virtual Studio", "Photogrammetry", "LiDAR Scanning", "Volumetric Capture", "Virtual Production", "Digital Twins"]
};

module.exports = { vendorTypes, skillGroups, FALLBACK_VENDOR_TYPES };
