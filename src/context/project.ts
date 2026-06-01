import * as fs from "fs";
import * as path from "path";

export interface ProjectContext {
  type: "vue-fastapi" | "django-react" | "custom";
  hasDocker: boolean;
  hasKubernetes: boolean;
  services: string[];
  thinkubeConfig?: any;
  framework: {
    frontend?: "vue" | "react" | "angular";
    backend?: "fastapi" | "django" | "express";
  };
}

export async function detectProjectContext(
  projectPath: string,
): Promise<ProjectContext> {
  const context: ProjectContext = {
    type: "custom",
    hasDocker: false,
    hasKubernetes: false,
    services: [],
    framework: {},
  };

  // Check for Docker
  context.hasDocker =
    fs.existsSync(path.join(projectPath, "docker-compose.yml")) ||
    fs.existsSync(path.join(projectPath, "docker-compose.yaml")) ||
    fs.existsSync(path.join(projectPath, "Dockerfile"));

  // Check for Kubernetes
  context.hasKubernetes =
    fs.existsSync(path.join(projectPath, "k8s")) ||
    fs.existsSync(path.join(projectPath, "kubernetes")) ||
    fs.existsSync(path.join(projectPath, "manifests"));

  // Check for thinkube.yaml
  const thinkubeConfigPath = path.join(projectPath, "thinkube.yaml");
  if (fs.existsSync(thinkubeConfigPath)) {
    try {
      const content = fs.readFileSync(thinkubeConfigPath, "utf8");
      // Basic YAML parsing - in production, use a proper YAML parser
      context.thinkubeConfig = content;
    } catch (error) {
      console.error("Error reading thinkube.yaml:", error);
    }
  }

  // Detect frontend framework
  const packageJsonPath = path.join(projectPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (deps["vue"] || deps["@vue/cli"]) {
        context.framework.frontend = "vue";
      } else if (deps["react"] || deps["react-dom"]) {
        context.framework.frontend = "react";
      } else if (deps["@angular/core"]) {
        context.framework.frontend = "angular";
      }
    } catch (error) {
      console.error("Error reading package.json:", error);
    }
  }

  // Check frontend in subdirectory
  const frontendPath = path.join(projectPath, "frontend", "package.json");
  if (fs.existsSync(frontendPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(frontendPath, "utf8"));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (deps["vue"] || deps["@vue/cli"]) {
        context.framework.frontend = "vue";
      } else if (deps["react"] || deps["react-dom"]) {
        context.framework.frontend = "react";
      } else if (deps["@angular/core"]) {
        context.framework.frontend = "angular";
      }
    } catch (error) {
      console.error("Error reading frontend package.json:", error);
    }
  }

  // Detect backend framework
  const requirementsPaths = [
    path.join(projectPath, "requirements.txt"),
    path.join(projectPath, "backend", "requirements.txt"),
    path.join(projectPath, "pyproject.toml"),
    path.join(projectPath, "backend", "pyproject.toml"),
  ];

  for (const reqPath of requirementsPaths) {
    if (fs.existsSync(reqPath)) {
      try {
        const content = fs.readFileSync(reqPath, "utf8");
        if (content.includes("fastapi")) {
          context.framework.backend = "fastapi";
          break;
        } else if (content.includes("django")) {
          context.framework.backend = "django";
          break;
        }
      } catch (error) {
        console.error(`Error reading ${reqPath}:`, error);
      }
    }
  }

  // Check for Express in package.json
  if (context.framework.backend === undefined) {
    const backendPackageJsonPath = path.join(
      projectPath,
      "backend",
      "package.json",
    );
    if (fs.existsSync(backendPackageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          fs.readFileSync(backendPackageJsonPath, "utf8"),
        );
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        if (deps["express"]) {
          context.framework.backend = "express";
        }
      } catch (error) {
        console.error("Error reading backend package.json:", error);
      }
    }
  }

  // Determine project type
  if (
    context.framework.frontend === "vue" &&
    context.framework.backend === "fastapi"
  ) {
    context.type = "vue-fastapi";
  } else if (
    context.framework.frontend === "react" &&
    context.framework.backend === "django"
  ) {
    context.type = "django-react";
  }

  // Detect services from docker-compose
  const dockerComposePaths = [
    path.join(projectPath, "docker-compose.yml"),
    path.join(projectPath, "docker-compose.yaml"),
  ];

  for (const composePath of dockerComposePaths) {
    if (fs.existsSync(composePath)) {
      try {
        const content = fs.readFileSync(composePath, "utf8");

        // Basic service detection - in production, use proper YAML parser
        if (content.includes("postgres") || content.includes("postgresql")) {
          context.services.push("postgresql");
        }
        if (content.includes("redis")) {
          context.services.push("redis");
        }
        if (content.includes("mysql")) {
          context.services.push("mysql");
        }
        if (content.includes("mongo")) {
          context.services.push("mongodb");
        }
        if (content.includes("rabbitmq")) {
          context.services.push("rabbitmq");
        }
        if (content.includes("minio")) {
          context.services.push("minio");
        }
        if (content.includes("keycloak")) {
          context.services.push("keycloak");
        }
      } catch (error) {
        console.error(`Error reading ${composePath}:`, error);
      }
    }
  }

  return context;
}

export function getProjectRoot(startPath: string): string | null {
  let currentPath = startPath;

  // Look for common project root indicators
  while (currentPath !== path.dirname(currentPath)) {
    if (
      fs.existsSync(path.join(currentPath, ".git")) ||
      fs.existsSync(path.join(currentPath, "package.json")) ||
      fs.existsSync(path.join(currentPath, "pyproject.toml")) ||
      fs.existsSync(path.join(currentPath, "docker-compose.yml")) ||
      fs.existsSync(path.join(currentPath, "thinkube.yaml"))
    ) {
      return currentPath;
    }
    currentPath = path.dirname(currentPath);
  }

  return null;
}
