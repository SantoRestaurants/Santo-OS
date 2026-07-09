
import os
import sys
from dotenv import load_dotenv

load_dotenv('.env.local')
sys.path.insert(0, os.getcwd())

from services.agent_mail.poller import _poll_workflow_runs, _load_supabase_client
sb = _load_supabase_client()
_poll_workflow_runs(sb)
print('Done!')

