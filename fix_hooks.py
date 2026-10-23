import re

with open('packages/react/src/hooks/useAgents.ts', 'r') as f:
    content = f.read()

# Replace useCreateAgent
content = re.sub(
    r'export function useCreateAgent\(\).*?onSettled: \(\) => \{\n      // Invalidate so TanStack Query re-fetches the authoritative state\.\n      void queryClient\.invalidateQueries\(\{ queryKey: queryKeys\.agents\.all \}\);\n    \},\n  \}\);\n\}',
    '''export function useCreateAgent(): UseMutationResult<Agent, Error, CreateAgentParams> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateAgentParams) => astroid.agents.create(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}''',
    content, flags=re.DOTALL
)

# Replace useUpdateAgent
content = re.sub(
    r'export function useUpdateAgent\(\).*?onSettled: \(_data, _error, \{ id \}\) => \{\n      void invalidateAgentQueries\(queryClient, id\);\n    \},\n  \}\);\n\}',
    '''export function useUpdateAgent(): UseMutationResult<Agent, Error, UpdateAgentVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, params }: UpdateAgentVariables) => astroid.agents.update(id, params),
    onSuccess: (_data, { id }) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}''',
    content, flags=re.DOTALL
)

# Replace useDeleteAgent
content = re.sub(
    r'export function useDeleteAgent\(\).*?onSettled: \(_data, _error, id\) => \{\n      void invalidateAgentQueries\(queryClient, id\);\n    \},\n  \}\);\n\}',
    '''export function useDeleteAgent(): UseMutationResult<void, Error, string> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => astroid.agents.delete(id),
    onSuccess: (_data, id) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}''',
    content, flags=re.DOTALL
)

# Replace useUpdateAgentStatus
content = re.sub(
    r'export function useUpdateAgentStatus\(\).*?onSettled: \(_data, _error, \{ id \}\) => \{\n      void invalidateAgentQueries\(queryClient, id\);\n    \},\n  \}\);\n\}',
    '''export function useUpdateAgentStatus(): UseMutationResult<Agent, Error, UpdateAgentStatusVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: UpdateAgentStatusVariables) => astroid.agents.update(id, { status }),
    onSuccess: (_data, { id }) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}''',
    content, flags=re.DOTALL
)

# Replace useUpdateAgentMetadata
content = re.sub(
    r'export function useUpdateAgentMetadata\(\).*?onSettled: \(_data, _error, \{ id \}\) => \{\n      void invalidateAgentQueries\(queryClient, id\);\n    \},\n  \}\);\n\}',
    '''export function useUpdateAgentMetadata(): UseMutationResult<Agent, Error, UpdateAgentMetadataVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, metadata }: UpdateAgentMetadataVariables) => astroid.agents.update(id, { metadata }),
    onSuccess: (_data, { id }) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}''',
    content, flags=re.DOTALL
)

with open('packages/react/src/hooks/useAgents.ts', 'w') as f:
    f.write(content)

