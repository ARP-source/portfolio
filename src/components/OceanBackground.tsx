"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export default function OceanBackground() {
  const ref = useRef(null);
  
  const { scrollYProgress } = useScroll();

  // Sky layer: visible at top, fades out as we scroll
  const skyOpacity = useTransform(scrollYProgress, [0, 0.3, 0.4], [1, 1, 0]);
  
  // Mid-water layer: fades in around 0.2, peaks at 0.5, fades out by 0.8
  const midWaterOpacity = useTransform(scrollYProgress, [0.2, 0.35, 0.65, 0.8], [0, 1, 1, 0]);
  
  // Deep ocean layer: fades in starting at 0.6
  const deepOpacity = useTransform(scrollYProgress, [0.6, 0.8, 1], [0, 1, 1]);

  // Light rays opacity for mid-water effect
  const lightRaysOpacity = useTransform(scrollYProgress, [0.25, 0.4, 0.6, 0.75], [0, 0.4, 0.4, 0]);

  return (
    <div 
      ref={ref}
      className="fixed inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    >
      {/* Base layer - always visible dark blue */}
      <div className="absolute inset-0 bg-slate-950" />

      {/* Deep ocean layer - dark navy/black */}
      <motion.div
        className="absolute inset-0"
        style={{
          opacity: deepOpacity,
          background: "linear-gradient(180deg, #0a1628 0%, #020617 40%, #000308 100%)",
        }}
      />

      {/* Mid-water layer - underwater blue with depth */}
      <motion.div
        className="absolute inset-0"
        style={{
          opacity: midWaterOpacity,
          background: "linear-gradient(180deg, #0ea5e9 0%, #0369a1 30%, #075985 60%, #0c4a6e 100%)",
        }}
      />

      {/* Light rays effect for mid-water */}
      <motion.div
        className="absolute inset-0"
        style={{
          opacity: lightRaysOpacity,
          background: `
            radial-gradient(ellipse 80% 50% at 30% 0%, rgba(125, 211, 252, 0.4) 0%, transparent 50%),
            radial-gradient(ellipse 60% 40% at 70% 0%, rgba(186, 230, 253, 0.3) 0%, transparent 40%),
            radial-gradient(ellipse 50% 35% at 50% 0%, rgba(224, 242, 254, 0.25) 0%, transparent 35%)
          `,
        }}
      />

      {/* Sunset sky layer - warm orange/pink to blue */}
      <motion.div
        className="absolute inset-0"
        style={{
          opacity: skyOpacity,
          background: `linear-gradient(180deg, 
            #fcd34d 0%, 
            #fb923c 15%, 
            #f472b6 30%, 
            #c084fc 45%, 
            #818cf8 55%, 
            #38bdf8 70%, 
            #0ea5e9 85%, 
            #0284c7 100%
          )`,
        }}
      />

      {/* Sun glow effect at the very top */}
      <motion.div
        className="absolute inset-0"
        style={{
          opacity: useTransform(scrollYProgress, [0, 0.2, 0.35], [1, 0.5, 0]),
          background: `radial-gradient(ellipse 100% 40% at 50% 0%, rgba(253, 224, 71, 0.6) 0%, rgba(251, 146, 60, 0.3) 30%, transparent 60%)`,
        }}
      />

      {/* Subtle particle/bubble effect overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: useTransform(scrollYProgress, [0.3, 0.5, 0.9, 1], [0, 0.15, 0.15, 0.05]),
          backgroundImage: `
            radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.3) 1px, transparent 0),
            radial-gradient(1px 1px at 40% 70%, rgba(255,255,255,0.2) 1px, transparent 0),
            radial-gradient(1.5px 1.5px at 60% 20%, rgba(255,255,255,0.25) 1px, transparent 0),
            radial-gradient(1px 1px at 80% 50%, rgba(255,255,255,0.2) 1px, transparent 0),
            radial-gradient(1.5px 1.5px at 10% 80%, rgba(255,255,255,0.15) 1px, transparent 0),
            radial-gradient(1px 1px at 90% 90%, rgba(255,255,255,0.2) 1px, transparent 0)
          `,
          backgroundSize: "100% 100%",
        }}
      />
    </div>
  );
}
