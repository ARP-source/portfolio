"use client";

import { motion } from "framer-motion";
import { ExternalLink, Code } from "lucide-react";

const projects = [
  {
    title: "E-Commerce Platform",
    description:
      "A full-featured online store with cart, payments, and admin dashboard. Built with Next.js, Stripe, and PostgreSQL.",
    tags: ["Next.js", "Stripe", "PostgreSQL", "TailwindCSS"],
    liveUrl: "#",
    githubUrl: "#",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    title: "Task Management App",
    description:
      "Real-time collaborative task manager with drag-and-drop, notifications, and team features.",
    tags: ["React", "Node.js", "Socket.io", "MongoDB"],
    liveUrl: "#",
    githubUrl: "#",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    title: "AI Content Generator",
    description:
      "An AI-powered tool that generates blog posts, social media content, and marketing copy.",
    tags: ["Python", "OpenAI", "FastAPI", "React"],
    liveUrl: "#",
    githubUrl: "#",
    gradient: "from-orange-500 to-red-500",
  },
  {
    title: "Portfolio Dashboard",
    description:
      "Investment portfolio tracker with real-time data, analytics, and performance charts.",
    tags: ["TypeScript", "D3.js", "Express", "Redis"],
    liveUrl: "#",
    githubUrl: "#",
    gradient: "from-green-500 to-emerald-500",
  },
];

interface ProjectCardProps {
  project: typeof projects[0];
  index: number;
}

function ProjectCard({ project, index }: ProjectCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ 
        duration: 0.6, 
        delay: index * 0.15,
        ease: "easeOut"
      }}
    >
      <motion.div
        animate={{ 
          y: [0, -8, 0],
        }}
        transition={{
          duration: 6 + index * 0.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="group bg-white/90 dark:bg-zinc-800/80 backdrop-blur-sm rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-shadow duration-300"
      >
        <div
          className={`h-48 bg-gradient-to-br ${project.gradient} flex items-center justify-center`}
        >
          <span className="text-6xl font-bold text-white/20">
            {project.title.charAt(0)}
          </span>
        </div>
        <div className="p-6">
          <h3 className="text-xl font-semibold text-zinc-900 dark:text-white mb-2">
            {project.title}
          </h3>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            {project.description}
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {project.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 text-sm bg-zinc-100/80 dark:bg-zinc-700/80 text-zinc-600 dark:text-zinc-300 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="flex gap-4">
            <a
              href={project.liveUrl}
              className="inline-flex items-center gap-2 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
            >
              <ExternalLink size={18} />
              Live Demo
            </a>
            <a
              href={project.githubUrl}
              className="inline-flex items-center gap-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white font-medium transition-colors"
            >
              <Code size={18} />
              Code
            </a>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Projects() {
  return (
    <section
      id="projects"
      className="py-24 px-6 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm"
    >
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white mb-4">
            Featured Projects
          </h2>
          <div className="w-20 h-1 bg-gradient-to-r from-blue-500 to-purple-600 mx-auto rounded-full" />
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8">
          {projects.map((project, index) => (
            <ProjectCard key={project.title} project={project} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
