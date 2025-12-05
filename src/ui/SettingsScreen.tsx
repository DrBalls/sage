import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';
import { AVAILABLE_MODELS, OPENAI_MODELS, ANTHROPIC_MODELS, GEMINI_MODELS, type ModelConfig } from '../lib/models.js';

interface SettingsScreenProps {
  currentModel: string;
  debugMode: boolean;
  onSelectModel: (modelId: string) => void;
  onToggleDebugMode: () => void;
  onBack: () => void;
}

// Group models by provider for display
const MODEL_GROUPS: { name: string; models: ModelConfig[] }[] = [
  { name: 'OpenAI (Codex)', models: OPENAI_MODELS },
  { name: 'Anthropic (Claude)', models: ANTHROPIC_MODELS },
  { name: 'Google (Gemini)', models: GEMINI_MODELS },
];

// Total selectable items: models + 1 debug toggle
const DEBUG_TOGGLE_INDEX = AVAILABLE_MODELS.length;

export function SettingsScreen({ currentModel, debugMode, onSelectModel, onToggleDebugMode, onBack }: SettingsScreenProps) {
  const currentModelIndex = AVAILABLE_MODELS.findIndex((m) => m.id === currentModel);
  const [selectedIndex, setSelectedIndex] = useState(currentModelIndex >= 0 ? currentModelIndex : 0);

  const totalItems = AVAILABLE_MODELS.length + 1; // models + debug toggle

  useInput((input: string, key: Key) => {
    if (key.escape || input.toLowerCase() === 'b') {
      onBack();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, totalItems - 1));
      return;
    }

    if (key.return) {
      if (selectedIndex === DEBUG_TOGGLE_INDEX) {
        onToggleDebugMode();
      } else {
        const model = AVAILABLE_MODELS[selectedIndex];
        onSelectModel(model.id);
      }
      return;
    }
  });

  // Calculate the starting index for each provider group
  let modelIndex = 0;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Settings</Text>
      <Text>{'─'.repeat(40)}</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>Select Review Agent Model:</Text>
        <Box marginTop={1} flexDirection="column">
          {MODEL_GROUPS.map((group) => {
            const groupStartIndex = modelIndex;
            modelIndex += group.models.length;
            return (
              <Box key={group.name} flexDirection="column" marginBottom={1}>
                <Text dimColor>{group.name}</Text>
                {group.models.map((model, idx) => {
                  const absoluteIndex = groupStartIndex + idx;
                  return (
                    <ModelRow
                      key={model.id}
                      model={model}
                      isSelected={absoluteIndex === selectedIndex}
                      isCurrent={model.id === currentModel}
                    />
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>Debug Mode:</Text>
        <Box marginTop={1}>
          <Text inverse={selectedIndex === DEBUG_TOGGLE_INDEX}>
            {debugMode ? '✓ ON' : '  OFF'}
          </Text>
          <Text dimColor> (shows verbose status messages)</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ↑ ↓ to move, ↵ to select/toggle, ESC/B to go back</Text>
      </Box>
    </Box>
  );
}

interface ModelRowProps {
  model: ModelConfig;
  isSelected: boolean;
  isCurrent: boolean;
}

function ModelRow({ model, isSelected, isCurrent }: ModelRowProps) {
  const checkmark = isCurrent ? '✓ ' : '  ';
  const label = `${checkmark}${model.name}`;

  return (
    <Box>
      <Text inverse={isSelected}>
        {label}
      </Text>
      {isCurrent && !isSelected && (
        <Text dimColor> (current)</Text>
      )}
    </Box>
  );
}
