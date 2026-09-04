import re

with open("web/src/components/Settings.tsx", "r") as f:
    content = f.read()

variables_to_insert = """
  // Profile State
  const { data: profiles, refetch: refetchProfiles } = useApi<Profile[]>('/api/profiles');
  const activeProfileId = Number(localStorage.getItem('tvapp_active_profile_id'));
  const isAdmin = profiles?.find(p => p.id === activeProfileId)?.is_admin === true;

  const [showAddProfileModal, setShowAddProfileModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showDeleteProfileModal, setShowDeleteProfileModal] = useState<Profile | null>(null);
  
  const [editProfileData, setEditProfileData] = useState<Profile | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfilePin, setNewProfilePin] = useState("");
  const [newProfileAvatar, setNewProfileAvatar] = useState(AVATAR_SEEDS[0]);

  // Modals
"""

content = content.replace("  // Modals\n", variables_to_insert)

with open("web/src/components/Settings.tsx", "w") as f:
    f.write(content)
