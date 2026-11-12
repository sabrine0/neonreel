# Neonreel - made by sabrine0 (https://github.com/sabrine0)
class RequestError(Exception):
    """A problem to show to the user as it is, with the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
