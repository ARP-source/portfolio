"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Code2, Link, Mail, ArrowDown } from "lucide-react";

function Bird({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <motion.svg
      viewBox="0 0 24 12"
      className={className}
      animate={{ y: [0, -4, 0, 4, 0] }}
      transition={{
        duration: 2.5,
        repeat: Infinity,
        ease: "easeInOut",
        delay,
      }}
    >
      <path
        d="M0 6 Q6 0, 12 6 Q18 0, 24 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </motion.svg>
  );
}

function Cloud({ className, duration = 60, delay = 0 }: { className?: string; duration?: number; delay?: number }) {
  return (
    <motion.div
      className={`absolute ${className}`}
      initial={{ x: "-100%" }}
      animate={{ x: "100vw" }}
      transition={{
        duration,
        repeat: Infinity,
        ease: "linear",
        delay,
      }}
    >
      <svg viewBox="0 0 200 80" className="w-full h-full" fill="currentColor">
        <ellipse cx="60" cy="50" rx="50" ry="25" />
        <ellipse cx="100" cy="40" rx="40" ry="20" />
        <ellipse cx="140" cy="50" rx="45" ry="22" />
        <ellipse cx="80" cy="35" rx="30" ry="18" />
        <ellipse cx="120" cy="55" rx="35" ry="18" />
      </svg>
    </motion.div>
  );
}

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  const birdsOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const cloudsOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section 
      ref={heroRef}
      className="relative h-screen min-h-screen flex items-center justify-center pt-20 px-6 overflow-hidden"
    >
      {/* Sun */}
      <div className="absolute bottom-[15%] left-1/2 -translate-x-1/2 w-32 h-32 md:w-48 md:h-48">
        <div className="w-full h-full rounded-full bg-gradient-to-b from-yellow-300 via-orange-400 to-orange-500 blur-sm" />
        <div className="absolute inset-2 rounded-full bg-gradient-to-b from-yellow-200 via-yellow-300 to-orange-400" />
        {/* Sun glow */}
        <div className="absolute -inset-8 rounded-full bg-gradient-radial from-yellow-300/40 via-orange-400/20 to-transparent blur-xl" />
      </div>

      {/* Clouds */}
      <motion.div style={{ opacity: cloudsOpacity }} className="absolute inset-0 pointer-events-none">
        <Cloud 
          className="top-[10%] text-white/70 w-40 md:w-56" 
          duration={80} 
          delay={0} 
        />
        <Cloud 
          className="top-[25%] text-white/50 w-32 md:w-44" 
          duration={100} 
          delay={20} 
        />
        <Cloud 
          className="top-[18%] text-white/60 w-36 md:w-48" 
          duration={90} 
          delay={45} 
        />
      </motion.div>

      {/* Birds */}
      <motion.div 
        style={{ opacity: birdsOpacity }} 
        className="absolute inset-0 pointer-events-none text-zinc-800/70 dark:text-zinc-700"
      >
        <Bird className="absolute top-[20%] left-[15%] w-6 md:w-8" delay={0} />
        <Bird className="absolute top-[25%] left-[22%] w-5 md:w-6" delay={0.3} />
        <Bird className="absolute top-[18%] left-[28%] w-4 md:w-5" delay={0.6} />
        <Bird className="absolute top-[30%] right-[20%] w-6 md:w-8" delay={0.2} />
        <Bird className="absolute top-[22%] right-[30%] w-5 md:w-7" delay={0.5} />
      </motion.div>

      {/* Dark gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="w-32 h-32 mx-auto rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-4xl font-bold shadow-lg">
            JD
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-4xl md:text-6xl font-bold text-zinc-900 dark:text-white mb-4"
        >
          Hi, I&apos;m{" "}
          <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
            John Doe
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-xl md:text-2xl text-zinc-600 dark:text-zinc-400 mb-8"
        >
          Full Stack Developer | Building modern web experiences
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-lg text-zinc-500 dark:text-zinc-500 max-w-2xl mx-auto mb-10"
        >
          I craft beautiful, performant, and accessible web applications using
          cutting-edge technologies. Let&apos;s build something amazing together.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="flex items-center justify-center gap-4 mb-12"
        >
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-white transition-all"
          >
            <Code2 size={24} />
          </a>
          <a
            href="https://linkedin.com"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-white transition-all"
          >
            <Link size={24} />
          </a>
          <a
            href="mailto:hello@example.com"
            className="p-3 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-white transition-all"
          >
            <Mail size={24} />
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.8 }}
        >
          <a
            href="#about"
            className="inline-flex items-center gap-2 text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <span>Scroll to explore</span>
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <ArrowDown size={20} />
            </motion.div>
          </a>
        </motion.div>
      </div>
    </section>
  );
}
