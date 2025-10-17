// This module only loads in development and is completely excluded from production builds
import { setupVite as originalSetupVite } from "./vite";
import { type Express } from "express";
import { type Server } from "http";

export const setupVite = originalSetupVite;