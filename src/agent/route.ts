/**
 * Cheap robot-intent screen so chitchat can skip the OpenClaw agent.
 * Ambiguous turns still go to the fast LLM, which can escalate via robot_agent.
 */

import { heardContainsPhrase, normalizeHeard } from "../voice/wake.js";

const ROBOT_PHRASES = [
  "what do you see",
  "what can you see",
  "what are you seeing",
  "can you see",
  "do you see",
  "look around",
  "look at",
  "looking at",
  "take a look",
  "look again",
  "have a look",
  "use your camera",
  "your camera",
  "the camera",
  "take a picture",
  "take a photo",
  "take a snapshot",
  "scan for",
  "scan your",
  "scan the",
  "scan around",
  "look for",
  "follow me",
  "start following",
  "stop following",
  "quit following",
  "come with me",
  "come here",
  "walk with me",
  "drive to",
  "navigate to",
  "move forward",
  "move back",
  "move backward",
  "go forward",
  "go backward",
  "turn left",
  "turn right",
  "turn around",
  "rotate",
  "spin around",
  "stop moving",
  "stop driving",
  "stop navigating",
  "wait here",
  "stay there",
  "stay here",
  "in front of you",
  "behind you",
  "to your left",
  "to your right",
  "on your left",
  "on your right",
  "your surroundings",
  "the surroundings",
  "pick up",
  "put down",
  "your arm",
  "your gripper",
];

const ROBOT_PATTERNS: RegExp[] = [
  /\b(lidar|realsense|real sense|cmd[ _]?vel)\b/,
  /\b(ros topic|ros node|occupancy grid)\b/,
  /\bfollow(ing)? me\b/,
  /\bstop following\b/,
  /\bscan (for|your|the|around)\b/,
  /\b(grasp|dock|undock)\b/,
  /\b(navigate|localization|amcl|nav2)\b/,
];

export function looksLikeRobotRequest(utterance: string): boolean {
  const heard = normalizeHeard(utterance);
  if (!heard) return false;
  for (const phrase of ROBOT_PHRASES) {
    if (heardContainsPhrase(heard, phrase)) return true;
  }
  return ROBOT_PATTERNS.some((re) => re.test(heard));
}
